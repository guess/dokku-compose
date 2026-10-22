import { describe, it, expect, vi } from 'vitest'
import { createRunner, DokkuCommandError } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { runUp, UpFailedError } from './up.js'
import { loadConfig } from '../core/config.js'
import { ConfigSchema } from '../core/schema.js'
import path from 'path'
import { emptyAnswer } from '../tests/fake-server.js'

const FIXTURES = path.join(import.meta.dirname, '../tests/fixtures')

// Strict reads go through the same stub as lenient ones; an empty
// `plugin:list` reads as no plugins installed.
function stubStrict(runner: ReturnType<typeof createRunner>) {
  runner.queryStrict = vi.fn(async (...args: string[]) => {
    const out = await runner.query(...args)
    if (!out && args.join(' ') === 'config:export --global --format json') return '{}'
    return args[0] === 'plugin:list' && !out ? '[]' : out
  })
  // No registry login stored yet; a login goes through runner.run like any other mutation.
  runner.status = vi.fn(async () => 1)
  runner.runWithInput = vi.fn(async (_input: string, ...args: string[]) => runner.run(...args))
}

describe('runUp', () => {
  it('creates app and services from simple.yml', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.run = vi.fn()
    runner.query = vi.fn(async (...args: string[]) => args[0] === 'version' ? 'dokku version 0.38.31' : '')
    stubStrict(runner)
    const ctx = createContext(runner)
    const config = loadConfig(path.join(FIXTURES, 'simple.yml'))
    await runUp(ctx, config, [])
    expect(runner.run).toHaveBeenCalledWith('apps:create', 'myapp')
    expect(runner.run).toHaveBeenCalledWith('postgres:create', 'myapp-postgres')
    expect(runner.run).toHaveBeenCalledWith('postgres:link', 'myapp-postgres', 'myapp', '--no-restart')
  })

  it('dry-run skips commands for resources already in sync', async () => {
    const runner = createRunner({ dryRun: true })
    // Simulate server where app and network already exist
    runner.check = vi.fn().mockImplementation(async (...args: string[]) => {
      const cmd = args.join(' ')
      if (cmd === 'apps:exists myapp') return true
      if (cmd === 'network:exists app-net') return true
      if (cmd === 'postgres:exists myapp-postgres') return true
      return false
    })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      const cmd = args.join(' ')
      if (cmd === 'version') return 'dokku version 0.38.31'
      // App already has the right ports
      if (cmd === 'ports:report myapp --ports-map') return 'http:5000:5000'
      // Plugin already installed
      if (cmd === 'plugin:list') return 'postgres'
      // Service already linked
      if (cmd === 'postgres:info myapp-postgres --links') return 'myapp'
      return emptyAnswer(...args) ?? ''
    })
    runner.run = vi.fn()
    stubStrict(runner)
    const ctx = createContext(runner)
    const config = loadConfig(path.join(FIXTURES, 'simple.yml'))
    await runUp(ctx, config, [])

    // Since everything is in sync, no mutation commands should be recorded
    const runCalls = runner.run.mock.calls.map((c: string[]) => c.join(' '))
    expect(runCalls).not.toContainEqual(expect.stringContaining('apps:create'))
    expect(runCalls).not.toContainEqual(expect.stringContaining('network:create'))
  })

  it('dry-run plans the backup of a postgres service it would create, without reading it', async () => {
    const runner = createRunner({ dryRun: true })
    runner.check = vi.fn(async () => false)
    runner.query = vi.fn(async (...args: string[]) => {
      if (args.join(' ') === 'version') return 'dokku version 0.38.31'
      return emptyAnswer(...args) ?? ''
    })
    runner.run = vi.fn()
    stubStrict(runner)
    const lenient = runner.queryStrict
    runner.queryStrict = vi.fn(async (...args: string[]) => {
      // Dokku errors on the info of a service that does not exist.
      if (args[0] === 'postgres:info') throw new Error('Postgres service new-db does not exist')
      return lenient(...args)
    })
    const config = ConfigSchema.parse({
      apps: {},
      postgres: {
        'new-db': {
          backup: {
            schedule: '0 * * * *',
            bucket: 'backups/new-db',
            auth: { access_key_id: 'K', secret_access_key: 'S', region: 'auto', signature_version: 's3v4', endpoint: 'https://r2.example.com' },
          },
        },
      },
    })
    await runUp(createContext(runner), config, [], { dryRun: true })
    const runCalls = runner.run.mock.calls.map((c: string[]) => c.join(' '))
    expect(runCalls).toContain('postgres:create new-db')
    expect(runCalls).toContain('postgres:backup-auth new-db K S auto s3v4 https://r2.example.com')
    expect(runCalls).toContain('postgres:backup-schedule new-db 0 * * * * backups/new-db')
  })

  it('filters to specific apps when appFilter provided', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.run = vi.fn()
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'version') return 'dokku version 0.38.31'
      return emptyAnswer(...args) ?? ''
    })
    stubStrict(runner)
    const ctx = createContext(runner)
    const config = loadConfig(path.join(FIXTURES, 'full.yml'))
    await runUp(ctx, config, ['myapp'])
    expect(runner.run).toHaveBeenCalledWith('apps:create', 'myapp')
    expect(runner.run).not.toHaveBeenCalledWith('apps:create', 'studio')
  })

  it('continues to the next app when one fails, and throws a summary at the end (default behaviour)', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'version') return 'dokku version 0.38.31'
      return emptyAnswer(...args) ?? ''
    })
    runner.run = vi.fn().mockImplementation(async (...args: string[]) => {
      // The first app's app-create fails; everything else succeeds.
      if (args[0] === 'apps:create' && args[1] === 'myapp') {
        throw new DokkuCommandError(args, 1, 'app already exists under a different owner')
      }
    })
    stubStrict(runner)
    const ctx = createContext(runner)
    const config = loadConfig(path.join(FIXTURES, 'full.yml'))

    let thrown: unknown
    try {
      await runUp(ctx, config, ['myapp', 'studio'])
    } catch (e) {
      thrown = e
    }

    expect(thrown).toBeInstanceOf(UpFailedError)
    expect((thrown as UpFailedError).failures.map(f => f.app)).toEqual(['myapp'])
    // studio still got processed even though myapp failed
    expect(runner.run).toHaveBeenCalledWith('apps:create', 'studio')
  })

  it('keeps reconciling an app after one of its resources throws, then reports the failure', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'version') return 'dokku version 0.38.31'
      return emptyAnswer(...args) ?? ''
    })
    runner.run = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'domains:add' || args[0] === 'domains:set') throw new DokkuCommandError(args, 1, 'domain boom')
    })
    stubStrict(runner)
    const ctx = createContext(runner)
    const config = loadConfig(path.join(FIXTURES, 'full.yml'))
    config.apps.myapp.domains = ['a.example.com']
    config.apps.myapp.env = { MY_KEY: 'v' }

    await expect(runUp(ctx, config, ['myapp'])).rejects.toBeInstanceOf(UpFailedError)
    const sets = (runner.run as any).mock.calls.filter((c: string[]) => c[0] === 'config:set')
    expect(sets.some((c: string[]) => c.includes('MY_KEY=v'))).toBe(true)
  })

  it('stops an app at once when its create step fails', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'version') return 'dokku version 0.38.31'
      return emptyAnswer(...args) ?? ''
    })
    runner.run = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'apps:create') throw new DokkuCommandError(args, 1, 'nope')
    })
    stubStrict(runner)
    const ctx = createContext(runner)
    const config = loadConfig(path.join(FIXTURES, 'full.yml'))
    config.apps.myapp.env = { MY_KEY: 'v' }
    await expect(runUp(ctx, config, ['myapp'])).rejects.toBeInstanceOf(UpFailedError)
    const calls = (runner.run as any).mock.calls.filter((c: string[]) => c[1] === 'myapp' || c.includes('myapp'))
    expect(calls.map((c: string[]) => c[0])).toEqual(['apps:create'])
  })

  it('--fail-fast stops at the first failing app instead of continuing', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'version') return 'dokku version 0.38.31'
      return emptyAnswer(...args) ?? ''
    })
    runner.run = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'apps:create' && args[1] === 'myapp') {
        throw new DokkuCommandError(args, 1, 'boom')
      }
    })
    stubStrict(runner)
    const ctx = createContext(runner)
    const config = loadConfig(path.join(FIXTURES, 'full.yml'))

    let thrown: unknown
    try {
      await runUp(ctx, config, ['myapp', 'studio'], { failFast: true })
    } catch (e) {
      thrown = e
    }

    expect(thrown).toBeInstanceOf(DokkuCommandError)
    // studio's phase never started
    expect(runner.run).not.toHaveBeenCalledWith('apps:create', 'studio')
  })

  it('aborts the whole run when a global-phase command fails, before any per-app work', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'version') return 'dokku version 0.38.31'
      return emptyAnswer(...args) ?? ''
    })
    runner.run = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'network:create') {
        throw new DokkuCommandError(args, 1, 'network already in use')
      }
    })
    stubStrict(runner)
    const ctx = createContext(runner)
    const config = loadConfig(path.join(FIXTURES, 'full.yml'))

    await expect(runUp(ctx, config, ['myapp'])).rejects.toThrow(DokkuCommandError)
    expect(runner.run).not.toHaveBeenCalledWith('apps:create', 'myapp')
  })
})

describe('runUp — settings removed from the file', () => {
  it('leaves non-env removals in place and prints one line per app with the count', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockImplementation(async (...args: string[]) => args[0] === 'apps:exists')
    runner.run = vi.fn()
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'version') return 'dokku version 0.38.31'
      if (args[0] === 'nginx:report') return '       Nginx proxy read timeout: 60s\n       Nginx client max body size: 1m\n'
      if (args[0] === 'logs:report') return JSON.stringify({ 'max-size': '10m' })
      return emptyAnswer(...args) ?? ''
    })
    stubStrict(runner)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await runUp(createContext(runner), { apps: { web: { nginx: { 'client-max-body-size': '1m' }, logs: {} } } }, [])
      const lines = warn.mock.calls.map(c => String(c[0]))
      expect(lines).toHaveLength(1)
      const reads = (runner.query as any).mock.calls.map((c: string[]) => c.join(' '))
      expect(reads.filter((r: string) => r === 'nginx:report web')).toHaveLength(1)
      expect(lines[0]).toContain('2 setting(s)')
      expect(lines[0]).toContain('dokku-compose diff')
      const cmds = (runner.run as any).mock.calls.map((c: string[]) => c[0])
      expect(cmds.filter((c: string) => /:set$|:unset$/.test(c))).toEqual([])
    } finally {
      warn.mockRestore()
    }
  })

  it('prints nothing when the box has no leftovers', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockImplementation(async (...args: string[]) => args[0] === 'apps:exists')
    runner.run = vi.fn()
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => args[0] === 'version' ? 'dokku version 0.38.31' : '')
    stubStrict(runner)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await runUp(createContext(runner), { apps: { web: {} } }, [])
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

describe('runUp — hint scope', () => {
  async function upWithLeftovers(apps: any) {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockImplementation(async (...args: string[]) => args[0] === 'apps:exists')
    runner.run = vi.fn()
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'version') return 'dokku version 0.38.31'
      if (args[0] === 'nginx:report') return '       Nginx proxy read timeout: 60s\n'
      if (args[0] === 'checks:report') return '       Checks disabled list: none\n       Checks wait to retire: 30\n'
      return emptyAnswer(...args) ?? ''
    })
    stubStrict(runner)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await runUp(createContext(runner), { apps }, [])
      return { warns: warn.mock.calls.map(c => String(c[0])), reads: (runner.query as any).mock.calls.map((c: string[]) => c[0]) }
    } finally {
      warn.mockRestore()
    }
  }

  it('a removed whole block gets no hint and no extra report read (diff is the full view)', async () => {
    const { warns, reads } = await upWithLeftovers({ web: {} })
    expect(warns).toEqual([])
    expect(reads).not.toContain('nginx:report')
  })

  it('checks is read before it is set, and its leftovers are not counted in the hint', async () => {
    const { warns, reads } = await upWithLeftovers({ web: { checks: { 'wait-to-retire': 10 } } })
    expect(warns).toEqual([])
    expect(reads).toContain('checks:report')
  })
})

describe('runUp --prune', () => {
  const config = { apps: { myapp: { nginx: { 'client-max-body-size': '50m' } } } } as any
  function box(dryRun: boolean) {
    const runner = createRunner({ dryRun })
    runner.check = vi.fn(async (...a: string[]) => a[0] === 'apps:exists')
    const read = async (...a: string[]) =>
      a[0] === 'version' ? 'dokku version 0.38.31' : a[0] === 'nginx:report' ? '       Nginx client max body size: 50m\n       Nginx proxy read timeout: 60s\n'
        : a[0] === 'plugin:list' ? '[]' : emptyAnswer(...a) ?? ''
    runner.query = vi.fn(read)
    runner.queryStrict = vi.fn(read)
    runner.run = vi.fn()
    return { runner, ctx: createContext(runner) }
  }

  it('resets what the file no longer declares only with prune', async () => {
    const off = box(false)
    await runUp(off.ctx, config, [])
    expect(off.ctx.commands).not.toContainEqual(['nginx:set', 'myapp', 'proxy-read-timeout'])
    const on = box(false)
    await runUp(on.ctx, config, [], { prune: true })
    expect(on.ctx.commands).toContainEqual(['nginx:set', 'myapp', 'proxy-read-timeout'])
  })

  it('with dry-run the reset is recorded by the runner, not executed', async () => {
    const { runner, ctx } = box(true)
    runner.run = vi.fn(async () => {})
    await runUp(ctx, config, [], { prune: true })
    expect(ctx.commands).toContainEqual(['nginx:set', 'myapp', 'proxy-read-timeout'])
    expect(runner.query).not.toHaveBeenCalledWith('nginx:set', expect.anything(), expect.anything())
  })

  it('never destroys or rescales', async () => {
    const { ctx } = box(false)
    await runUp(ctx, config, [], { prune: true })
    expect(ctx.commands.filter(c => /destroy|scale/.test(c[0]))).toEqual([])
  })
})
