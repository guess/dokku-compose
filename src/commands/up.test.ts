import { describe, it, expect, vi } from 'vitest'
import { createRunner, DokkuCommandError } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { runUp, UpFailedError } from './up.js'
import { loadConfig } from '../core/config.js'
import path from 'path'

const FIXTURES = path.join(import.meta.dirname, '../tests/fixtures')

// Strict reads go through the same stub as lenient ones; an empty
// `plugin:list` reads as no plugins installed.
function stubStrict(runner: ReturnType<typeof createRunner>) {
  runner.queryStrict = vi.fn(async (...args: string[]) => {
    const out = await runner.query(...args)
    return args[0] === 'plugin:list' && !out ? '[]' : out
  })
}

describe('runUp', () => {
  it('creates app and services from simple.yml', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.run = vi.fn()
    runner.query = vi.fn().mockResolvedValue('')
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
      // App already has the right ports
      if (cmd === 'ports:report myapp --ports-map') return 'http:5000:5000'
      // Plugin already installed
      if (cmd === 'plugin:list') return 'postgres'
      // Service already linked
      if (cmd === 'postgres:info myapp-postgres --links') return 'myapp'
      return ''
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

  it('filters to specific apps when appFilter provided', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.run = vi.fn()
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'version') return 'dokku version 0.35.12'
      return ''
    })
    stubStrict(runner)
    const ctx = createContext(runner)
    const config = loadConfig(path.join(FIXTURES, 'full.yml'))
    await runUp(ctx, config, ['funqtion'])
    expect(runner.run).toHaveBeenCalledWith('apps:create', 'funqtion')
    expect(runner.run).not.toHaveBeenCalledWith('apps:create', 'studio')
  })

  it('continues to the next app when one fails, and throws a summary at the end (default behaviour)', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'version') return 'dokku version 0.35.12'
      return ''
    })
    runner.run = vi.fn().mockImplementation(async (...args: string[]) => {
      // The first app's app-create fails; everything else succeeds.
      if (args[0] === 'apps:create' && args[1] === 'funqtion') {
        throw new DokkuCommandError(args, 1, 'app already exists under a different owner')
      }
    })
    stubStrict(runner)
    const ctx = createContext(runner)
    const config = loadConfig(path.join(FIXTURES, 'full.yml'))

    let thrown: unknown
    try {
      await runUp(ctx, config, ['funqtion', 'studio'])
    } catch (e) {
      thrown = e
    }

    expect(thrown).toBeInstanceOf(UpFailedError)
    expect((thrown as UpFailedError).failures.map(f => f.app)).toEqual(['funqtion'])
    // studio still got processed even though funqtion failed
    expect(runner.run).toHaveBeenCalledWith('apps:create', 'studio')
  })

  it('keeps reconciling an app after one of its resources throws, then reports the failure', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'version') return 'dokku version 0.35.12'
      return ''
    })
    runner.run = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'domains:add' || args[0] === 'domains:set') throw new DokkuCommandError(args, 1, 'domain boom')
    })
    stubStrict(runner)
    const ctx = createContext(runner)
    const config = loadConfig(path.join(FIXTURES, 'full.yml'))
    config.apps.funqtion.domains = ['a.example.com']
    config.apps.funqtion.env = { MY_KEY: 'v' }

    await expect(runUp(ctx, config, ['funqtion'])).rejects.toBeInstanceOf(UpFailedError)
    const sets = (runner.run as any).mock.calls.filter((c: string[]) => c[0] === 'config:set')
    expect(sets.some((c: string[]) => c.includes('MY_KEY=v'))).toBe(true)
  })

  it('stops an app at once when its create step fails', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'version') return 'dokku version 0.35.12'
      return ''
    })
    runner.run = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'apps:create') throw new DokkuCommandError(args, 1, 'nope')
    })
    stubStrict(runner)
    const ctx = createContext(runner)
    const config = loadConfig(path.join(FIXTURES, 'full.yml'))
    config.apps.funqtion.env = { MY_KEY: 'v' }
    await expect(runUp(ctx, config, ['funqtion'])).rejects.toBeInstanceOf(UpFailedError)
    const calls = (runner.run as any).mock.calls.filter((c: string[]) => c[1] === 'funqtion' || c.includes('funqtion'))
    expect(calls.map((c: string[]) => c[0])).toEqual(['apps:create'])
  })

  it('--fail-fast stops at the first failing app instead of continuing', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'version') return 'dokku version 0.35.12'
      return ''
    })
    runner.run = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'apps:create' && args[1] === 'funqtion') {
        throw new DokkuCommandError(args, 1, 'boom')
      }
    })
    stubStrict(runner)
    const ctx = createContext(runner)
    const config = loadConfig(path.join(FIXTURES, 'full.yml'))

    let thrown: unknown
    try {
      await runUp(ctx, config, ['funqtion', 'studio'], { failFast: true })
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
      if (args[0] === 'version') return 'dokku version 0.35.12'
      return ''
    })
    runner.run = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'network:create') {
        throw new DokkuCommandError(args, 1, 'network already in use')
      }
    })
    stubStrict(runner)
    const ctx = createContext(runner)
    const config = loadConfig(path.join(FIXTURES, 'full.yml'))

    await expect(runUp(ctx, config, ['funqtion'])).rejects.toThrow(DokkuCommandError)
    expect(runner.run).not.toHaveBeenCalledWith('apps:create', 'funqtion')
  })
})

describe('runUp — settings removed from the file', () => {
  it('leaves non-env removals in place and prints one line per app with the count', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockImplementation(async (...args: string[]) => args[0] === 'apps:exists')
    runner.run = vi.fn()
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'version') return 'dokku version 0.35.12'
      if (args[0] === 'nginx:report') return '       Nginx proxy read timeout: 60s\n       Nginx client max body size: 1m\n'
      if (args[0] === 'logs:report') return '       Logs max size: 10m\n'
      return ''
    })
    stubStrict(runner)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await runUp(createContext(runner), { apps: { web: {} } }, [])
      const lines = warn.mock.calls.map(c => String(c[0]))
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain('3 setting(s)')
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
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => args[0] === 'version' ? 'dokku version 0.35.12' : '')
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
