// `up --prune` against a stateful fake Dokku: reset commands, dry-run, and a
// clean `diff` afterwards.
import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { runUp } from './up.js'
import { computeDiff } from './diff.js'
import type { Config } from '../core/schema.js'
import { emptyAnswer } from '../tests/fake-server.js'

function fakeBox(dryRun = false) {
  const st = {
    nginx: { 'client-max-body-size': '50m', 'proxy-read-timeout': '60s' } as Record<string, string>,
    logs: { 'max-size': '10m' } as Record<string, string>,
    registry: { server: 'ghcr.io' } as Record<string, string>,
    scheduler: 'docker-local',
    ps: { 'restart-policy': 'always', 'stop-timeout-seconds': '30' } as Record<string, string>,
    network: { 'attach-post-create': 'net-a', 'initial-network': 'net-b', 'bind-all-interfaces': 'true', tld: 'internal' } as Record<string, string>,
    disabled: new Set(['web', 'worker']),
    skipped: new Set(['api']),
    wait: '30',
    build: ['--build-arg A=1', '--build-arg B=2', '--link x:y'],
  }
  const runner = createRunner({ dryRun })
  const log: string[] = []
  const section = (ns: string, label: string, kv: Record<string, string>) =>
    [`=====> myapp ${ns} information`, ...Object.entries(kv).map(([k, v]) => `       ${label} ${k.replaceAll('-', ' ')}: ${v}`)].join('\n')
  runner.check = vi.fn(async (...a: string[]) => a[0] === 'apps:exists')
  const read = async (...a: string[]) => {
    const c = a.join(' ')
    if (c === 'version') return 'dokku version 0.38.31'
    if (c.startsWith('nginx:report')) return section('nginx', 'Nginx', st.nginx)
    if (c.startsWith('logs:report')) return JSON.stringify(st.logs)
    if (c.startsWith('registry:report')) return section('registry', 'Registry', st.registry)
    if (c.startsWith('scheduler:report')) return section('scheduler', 'Scheduler', { selected: st.scheduler })
    if (c.startsWith('network:report')) return section('network', 'Network', st.network)
    if (c.startsWith('checks:report')) return section('checks', 'Checks', { 'disabled list': [...st.disabled].join(',') || 'none', 'skipped list': [...st.skipped].join(',') || 'none', 'wait to retire': st.wait })
    if (c.startsWith('docker-options:report')) return JSON.stringify({ 'build-list': st.build })
    if (c.startsWith('ps:report')) return JSON.stringify(st.ps)
    if (c === 'plugin:list' || c.startsWith('plugin:list')) return '[]'
    return emptyAnswer(...a) ?? ''
  }
  runner.query = vi.fn(read)
  runner.queryStrict = vi.fn(read)
  runner.run = vi.fn(async (...a: string[]) => {
    log.push(a.join(' '))
    if (dryRun) return
    const [cmd, , key, value] = a
    const tables: Record<string, Record<string, string>> = { 'nginx:set': st.nginx, 'logs:set': st.logs, 'registry:set': st.registry, 'ps:set': st.ps, 'network:set': st.network }
    if (tables[cmd]) { if (value === undefined) delete tables[cmd][key]; else tables[cmd][key] = value }
    if (cmd === 'scheduler:set') st.scheduler = ''
    if (cmd === 'checks:set') st.wait = ''
    // Dokku takes the process types as one comma-separated argument.
    const types = a.slice(2).flatMap(t => t.split(','))
    if (cmd === 'checks:enable') for (const t of types) { st.disabled.delete(t); st.skipped.delete(t) }
    if (cmd === 'checks:disable') types.forEach(t => st.disabled.add(t))
    if (cmd === 'checks:skip') types.forEach(t => st.skipped.add(t))
    if (cmd === 'docker-options:remove') st.build = st.build.filter(o => o !== a[3])
  })
  // The context caches reads, so a later `diff` (a new process in real use) gets a fresh one.
  return { ctx: createContext(runner), fresh: () => createContext(runner), st, log }
}

const declared = (extra: Record<string, unknown> = {}): Config => ({
  apps: { myapp: {
    nginx: { 'client-max-body-size': '50m' },
    logs: { 'max-size': '10m' },
    registry: { server: 'ghcr.io' },
    ps: { 'restart-policy': 'always' },
    network: { tld: 'internal' },
    checks: { disabled: ['web'] },
    build: { args: { A: '1' } },
    ...extra,
  } },
} as unknown as Config)

const removedKeys = (d: any) => Object.entries(d.apps.myapp).filter(([, v]: any) => v.status === 'extra').map(([k]) => k)

describe('up --prune', () => {
  it('without --prune nothing is reset', async () => {
    const { ctx, log } = fakeBox()
    await runUp(ctx, declared(), [])
    expect(log.filter(l => /^(docker-options:remove|checks:enable)|^[a-z]+:set \S+ [\w-]+$/.test(l))).toEqual([])
  })

  it('resets exactly the stale settings, one command each', async () => {
    const { ctx, log, st } = fakeBox()
    await runUp(ctx, declared(), [], { prune: true })
    expect(log).toEqual(expect.arrayContaining([
      'nginx:set myapp proxy-read-timeout',
      'proxy:build-config myapp',
      'scheduler:set myapp selected',
      'ps:set myapp stop-timeout-seconds',
      'network:set myapp attach-post-create',
      'network:set myapp initial-network',
      'network:set myapp bind-all-interfaces',
      'checks:enable myapp api',
      'checks:set myapp wait-to-retire',
      'docker-options:remove myapp build --build-arg B=2',
    ]))
    expect(log).not.toContain('network:set myapp tld')
    // Declared state survives: web and worker stay disabled, only the stale skip is cleared.
    expect([...st.disabled].sort()).toEqual(['web', 'worker'])
    expect([...st.skipped]).toEqual([])
    // web is already disabled on the box, so checks reads first and never re-disables it.
    expect(log.filter(l => /^checks:(disable|skip)/.test(l))).toEqual([])
    expect(log.filter(l => l.startsWith('docker-options:remove'))).toEqual(['docker-options:remove myapp build --build-arg B=2'])
    expect(log.some(l => /apps:destroy|ps:scale|destroy/.test(l))).toBe(false)
  })

  it('a block gone from the file is reset too (read once), and diff then shows no "-"', async () => {
    const { ctx, fresh, st } = fakeBox()
    const config = { apps: { myapp: {} } } as unknown as Config
    expect(removedKeys(await computeDiff(ctx, config)).length).toBeGreaterThan(0)
    await runUp(ctx, config, [], { prune: true })
    expect(st.nginx).toEqual({})
    expect(st.logs).toEqual({})
    expect(st.registry).toEqual({})
    expect(st.scheduler).toBe('')
    expect(st.ps).toEqual({})
    expect(st.network).toEqual({})
    expect(st.build).toEqual(['--link x:y'])
    expect(st.wait).toBe('')
    expect(st.disabled.size + st.skipped.size).toBe(0)
    expect(removedKeys(await computeDiff(fresh(), config))).toEqual([])
  })

  it('diff has no "-" for pruned resources after a declared-block prune', async () => {
    const { ctx, fresh } = fakeBox()
    await runUp(ctx, declared(), [], { prune: true })
    expect(removedKeys(await computeDiff(fresh(), declared()))).toEqual([])
  })

  it('--prune --dry-run lists the resets and changes nothing', async () => {
    const { ctx, st, log } = fakeBox(true)
    await runUp(ctx, declared(), [], { prune: true })
    expect(log).toContain('nginx:set myapp proxy-read-timeout')
    expect(st.nginx['proxy-read-timeout']).toBe('60s')
    expect(st.build).toHaveLength(3)
  })

  it('prints the leftover hint without --prune and not with it', async () => {
    const run = async (prune: boolean) => {
      const { ctx } = fakeBox()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await runUp(ctx, declared(), [], { prune })
      const text = warn.mock.calls.flat().join('\n')
      warn.mockRestore()
      return text
    }
    expect(await run(false)).toContain('left on the server')
    expect(await run(true)).not.toContain('left on the server')
  })
})

describe('checks type declared in the file and in an undeclared box list', () => {
  it('is not pruned; warns with the manual command; diff keeps the "-" by design', async () => {
    const { ctx, fresh, st, log } = fakeBox()
    st.skipped = new Set(['web'])
    st.wait = ''
    const err = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await runUp(ctx, declared(), [], { prune: true })
    const text = err.mock.calls.flat().join('\n')
    err.mockRestore()
    expect(log.some(l => l.startsWith('checks:enable'))).toBe(false)
    expect([...st.disabled].sort()).toEqual(['web', 'worker'])
    expect([...st.skipped]).toEqual(['web'])
    expect(text).toContain("dokku checks:enable myapp web")
    expect(removedKeys(await computeDiff(fresh(), declared()))).toEqual(['checks'])
  })
})

describe('network empty-value reset', () => {
  it('tld and bind-all-interfaces reset with no value; attach-post-create hyphenated', async () => {
    const { ctx, log } = fakeBox()
    await runUp(ctx, { apps: { myapp: { network: { initial_network: 'net-b' } } } } as unknown as Config, [], { prune: true })
    expect(log).toEqual(expect.arrayContaining([
      'network:set myapp tld', 'network:set myapp bind-all-interfaces', 'network:set myapp attach-post-create',
    ]))
    expect(log).not.toContain('network:set myapp initial-network')
  })

  it('attach-post-deploy clears when networks: [] (owned by networks:, not --prune)', async () => {
    const { ctx, log, st } = fakeBox()
    st.network['attach-post-deploy'] = 'net-a'
    await runUp(ctx, { apps: { myapp: { networks: [] } } } as unknown as Config, [])
    expect(log).toContain('network:set myapp attach-post-deploy')
  })
})
