import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { ensureGlobal, planGlobal, readGlobal } from './global.js'
import type { AppConfig } from '../core/schema.js'

/** `<report>:report --global --format json` with the given `global-` values (everything else empty). */
const globalJson = (values: Record<string, string>): string =>
  JSON.stringify(Object.fromEntries(Object.entries(values).map(([k, v]) => [`global-${k}`, v])))

function setup(reports: Record<string, string | Error>) {
  const runner = createRunner({ dryRun: false })
  runner.queryStrict = vi.fn(async (...args: string[]) => {
    const key = args.join(' ')
    const answer = reports[key]
    if (answer === undefined) throw new Error(`unexpected read: ${key}`)
    if (answer instanceof Error) throw answer
    return answer
  })
  runner.run = vi.fn()
  return createContext(runner)
}

let log: ReturnType<typeof vi.spyOn>
let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { log.mockRestore(); warn.mockRestore() })

describe('ensureGlobal: scalar blocks', () => {
  it('scheduler: a string is shorthand for selected; a matching value runs nothing', async () => {
    const same = setup({ 'scheduler:report --global --format json': globalJson({ selected: 'docker-local' }) })
    await ensureGlobal(same, 'scheduler', 'docker-local')
    expect(same.commands).toEqual([])

    const differs = setup({ 'scheduler:report --global --format json': globalJson({ selected: 'null' }) })
    await ensureGlobal(differs, 'scheduler', { selected: 'docker-local', shell: 'bash' })
    expect(differs.commands).toEqual([
      ['scheduler:set', '--global', 'selected', 'docker-local'],
      ['scheduler:set', '--global', 'shell', 'bash'],
    ])
  })

  it('registry: sets only the keys that differ, a boolean as true/false', async () => {
    const ctx = setup({ 'registry:report --global --format json': globalJson({ server: 'registry.example.com', 'push-on-release': 'false' }) })
    await ensureGlobal(ctx, 'registry', { server: 'registry.example.com', 'push-on-release': true, 'push-extra-tags': 'stable' })
    expect(ctx.commands).toEqual([
      ['registry:set', '--global', 'push-on-release', 'true'],
      ['registry:set', '--global', 'push-extra-tags', 'stable'],
    ])
  })

  it('checks and ps: numbers compare as their string form', async () => {
    const checks = setup({ 'checks:report --global --format json': globalJson({ 'wait-to-retire': '60' }) })
    await ensureGlobal(checks, 'checks', { 'wait-to-retire': 60 })
    expect(checks.commands).toEqual([])
    const ps = setup({ 'ps:report --global --format json': globalJson({ 'restart-policy': 'on-failure:10' }) })
    await ensureGlobal(ps, 'ps', { 'restart-policy': 'on-failure:5', 'stop-timeout-seconds': 60, 'skip-deploy': true })
    expect(ps.commands).toEqual([
      ['ps:set', '--global', 'restart-policy', 'on-failure:5'],
      ['ps:set', '--global', 'stop-timeout-seconds', '60'],
      ['ps:set', '--global', 'skip-deploy', 'true'],
    ])
  })

  it('git: sets the four global keys, including the limits that exist only globally', async () => {
    const ctx = setup({ 'git:report --global --format json': globalJson({}) })
    await ensureGlobal(ctx, 'git', { deploy_branch: 'main', keep_git_dir: true, archive_max_files: 20000, archive_max_size: '2147483648' })
    expect(ctx.commands).toEqual([
      ['git:set', '--global', 'deploy-branch', 'main'],
      ['git:set', '--global', 'keep-git-dir', 'true'],
      ['git:set', '--global', 'archive-max-files', '20000'],
      ['git:set', '--global', 'archive-max-size', '2147483648'],
    ])
  })

  it('nginx and logs: the same engine, so a key that left the block is pruned too', async () => {
    const reports = {
      'nginx:report --global --format json': globalJson({ 'client-max-body-size': '50m', hsts: 'true' }),
      'logs:report --global --format json': globalJson({ 'max-size': '50m', 'vector-image': 'v' }),
    }
    const nginx = setup(reports)
    await ensureGlobal(nginx, 'nginx', { 'client-max-body-size': '50m' }, { prune: true })
    expect(nginx.commands).toEqual([['nginx:set', '--global', 'hsts']])
    const logs = setup(reports)
    await ensureGlobal(logs, 'logs', { 'max-size': '50m' }, { prune: true })
    expect(logs.commands).toEqual([['logs:set', '--global', 'vector-image']])
  })
})

describe('ensureGlobal: build reads three reports', () => {
  const reports = (builder: Record<string, string> = {}, dockerfile: Record<string, string> = {}, appJson: Record<string, string> = {}) => ({
    'builder:report --global --format json': globalJson(builder),
    'builder-dockerfile:report --global --format json': globalJson(dockerfile),
    'app-json:report --global --format json': globalJson(appJson),
  })

  it('sets each key with its own command and lists the processed apps for rebuild', async () => {
    const ctx = setup(reports())
    await ensureGlobal(ctx, 'build', {
      selected: 'dockerfile', context: 'apps/api', skip_cleanup: true, dockerfile: 'docker/Dockerfile', app_json: 'docker/app.json',
    }, { apps: ['myapp', 'worker'], appConfigs: { myapp: {}, worker: {} } })
    expect(ctx.commands).toEqual([
      ['builder:set', '--global', 'selected', 'dockerfile'],
      ['builder:set', '--global', 'build-dir', 'apps/api'],
      ['builder:set', '--global', 'skip-cleanup', 'true'],
      ['builder-dockerfile:set', '--global', 'dockerfile-path', 'docker/Dockerfile'],
      ['app-json:set', '--global', 'appjson-path', 'docker/app.json'],
    ])
    expect([...ctx.rebuilds.keys()]).toEqual(['myapp', 'worker'])
    expect(ctx.restarts.size).toBe(0)
  })

  it('an app whose own build: declares the key is not listed; skip_cleanup lists nothing', async () => {
    const ctx = setup(reports())
    const appConfigs: Record<string, AppConfig> = { own: { build: { selected: 'pack' } }, plain: {} }
    await ensureGlobal(ctx, 'build', { selected: 'dockerfile', skip_cleanup: true }, { apps: ['own', 'plain'], appConfigs })
    expect([...ctx.rebuilds.keys()]).toEqual(['plain'])
    const only = setup(reports())
    await ensureGlobal(only, 'build', { skip_cleanup: true }, { apps: ['plain'], appConfigs })
    expect(only.rebuilds.size).toBe(0)
  })

  it('in sync runs nothing and lists nothing', async () => {
    const ctx = setup(reports({ selected: 'dockerfile', 'build-dir': 'apps/api' }, { 'dockerfile-path': 'Dockerfile' }, { 'appjson-path': 'app.json' }))
    await ensureGlobal(ctx, 'build', { selected: 'dockerfile', context: 'apps/api', dockerfile: 'Dockerfile', app_json: 'app.json' }, { apps: ['myapp'], appConfigs: { myapp: {} } })
    expect(ctx.commands).toEqual([])
    expect(ctx.rebuilds.size).toBe(0)
  })

  it('--prune clears a removed key with its own command and lists the apps for rebuild', async () => {
    const ctx = setup(reports({ selected: 'pack', 'skip-cleanup': 'true' }, { 'dockerfile-path': 'x/Dockerfile' }))
    await ensureGlobal(ctx, 'build', { skip_cleanup: true }, { prune: true, apps: ['myapp'], appConfigs: { myapp: {} } })
    expect(ctx.commands).toEqual([
      ['builder:set', '--global', 'selected'],
      ['builder-dockerfile:set', '--global', 'dockerfile-path'],
    ])
    expect([...ctx.rebuilds.keys()]).toEqual(['myapp'])
  })
})

describe('ensureGlobal: network', () => {
  const report = (values: Record<string, string>) => ({ 'network:report --global --format json': globalJson(values) })

  it('names are separate arguments; the order of a list does not matter', async () => {
    const same = setup(report({ 'attach-post-deploy': 'b a' }))
    await ensureGlobal(same, 'network', { attach_post_deploy: ['a', 'b'] })
    expect(same.commands).toEqual([])
    const ctx = setup(report({}))
    await ensureGlobal(ctx, 'network', { attach_post_deploy: ['backend-net', 'worker-net'], attach_post_create: ['init-net'] })
    expect(ctx.commands).toEqual([
      ['network:set', '--global', 'attach-post-deploy', 'backend-net', 'worker-net'],
      ['network:set', '--global', 'attach-post-create', 'init-net'],
    ])
  })

  it('[] and false clear a value only when the server has one', async () => {
    const empty = setup(report({}))
    await ensureGlobal(empty, 'network', { attach_post_deploy: [], attach_post_create: false, initial_network: false, tld: false })
    expect(empty.commands).toEqual([])
    const set = setup(report({ 'attach-post-deploy': 'x', 'attach-post-create': 'y', 'initial-network': 'z', tld: 'internal' }))
    await ensureGlobal(set, 'network', { attach_post_deploy: [], attach_post_create: false, initial_network: false, tld: false })
    expect(set.commands).toEqual([
      ['network:set', '--global', 'attach-post-deploy'],
      ['network:set', '--global', 'attach-post-create'],
      ['network:set', '--global', 'initial-network'],
      ['network:set', '--global', 'tld'],
    ])
  })

  it('bind_all_interfaces: false matches an unset value, as per app', async () => {
    const unset = setup(report({}))
    await ensureGlobal(unset, 'network', { bind_all_interfaces: false })
    expect(unset.commands).toEqual([])
    const on = setup(report({ 'bind-all-interfaces': 'true' }))
    await ensureGlobal(on, 'network', { bind_all_interfaces: false })
    expect(on.commands).toEqual([['network:set', '--global', 'bind-all-interfaces', 'false']])
    const off = setup(report({}))
    await ensureGlobal(off, 'network', { bind_all_interfaces: true })
    expect(off.commands).toEqual([['network:set', '--global', 'bind-all-interfaces', 'true']])
  })

  it('rebuild for attach and initial network, restart for tld and bind_all_interfaces, skipping apps that set the key themselves', async () => {
    const appConfigs: Record<string, AppConfig> = {
      plain: {},
      ownTld: { network: { tld: 'x' } },
      ownNets: { networks: ['backend-net'] },
    }
    const apps = ['plain', 'ownTld', 'ownNets']
    const attach = setup(report({}))
    await ensureGlobal(attach, 'network', { attach_post_deploy: ['backend-net'] }, { apps, appConfigs })
    expect([...attach.rebuilds.entries()]).toEqual([['plain', ['global network']], ['ownTld', ['global network']]])
    expect(attach.restarts.size).toBe(0)

    const initial = setup(report({}))
    await ensureGlobal(initial, 'network', { initial_network: 'bridge' }, { apps, appConfigs })
    expect([...initial.rebuilds.keys()]).toEqual(apps)

    const tld = setup(report({}))
    await ensureGlobal(tld, 'network', { tld: 'internal' }, { apps, appConfigs })
    expect([...tld.restarts.entries()]).toEqual([['plain', ['global network']], ['ownNets', ['global network']]])
    expect(tld.rebuilds.size).toBe(0)
  })

  it('--prune never clears attach_post_deploy, and a missing key is not a removal', async () => {
    const ctx = setup(report({ 'attach-post-deploy': 'backend-net', tld: 'internal' }))
    await ensureGlobal(ctx, 'network', { bind_all_interfaces: false }, { prune: true, apps: ['myapp'], appConfigs: { myapp: {} } })
    expect(ctx.commands).toEqual([['network:set', '--global', 'tld']])
    expect([...ctx.restarts.keys()]).toEqual(['myapp'])
  })
})

describe('ensureGlobal: removals and failures', () => {
  it('without --prune a removal is left on the server and counted in one warning', async () => {
    const ctx = setup({ 'ps:report --global --format json': globalJson({ 'restart-policy': 'always', 'skip-deploy': 'true' }) })
    await ensureGlobal(ctx, 'ps', { 'restart-policy': 'always' })
    expect(ctx.commands).toEqual([])
    const lines = warn.mock.calls.map(c => String(c[0]))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('1 global ps setting(s) no longer in the compose file were left on the server')
  })

  it('an empty declared block prunes everything the block could set (and an undeclared one is never passed in)', async () => {
    const ctx = setup({ 'checks:report --global --format json': globalJson({ 'wait-to-retire': '30' }) })
    await ensureGlobal(ctx, 'checks', {}, { prune: true })
    expect(ctx.commands).toEqual([['checks:set', '--global', 'wait-to-retire']])
  })

  it('an unreadable report is an error and nothing is set', async () => {
    for (const answer of [new Error('scheduler:report failed'), '', 'not json']) {
      const ctx = setup({ 'scheduler:report --global --format json': answer })
      await expect(ensureGlobal(ctx, 'scheduler', 'docker-local')).rejects.toThrow()
      expect(ctx.commands).toEqual([])
    }
  })

  it('a failing set aborts: the error reaches the caller', async () => {
    const ctx = setup({ 'scheduler:report --global --format json': globalJson({}) })
    ;(ctx.runner.run as any).mockRejectedValueOnce(new Error('dokku scheduler:set failed'))
    await expect(ensureGlobal(ctx, 'scheduler', 'docker-local')).rejects.toThrow('scheduler:set failed')
  })
})

describe('planGlobal and readGlobal', () => {
  it('plans changes and removals from a read, keyed by the compose-file names', async () => {
    const ctx = setup({ 'git:report --global --format json': globalJson({ 'deploy-branch': 'master', 'keep-git-dir': 'true' }) })
    const current = await readGlobal(ctx, 'git')
    expect(current).toEqual({ deploy_branch: 'master', keep_git_dir: 'true' })
    const plan = planGlobal('git', { deploy_branch: 'main' }, current)
    expect(plan.changes.map(c => c.gk.yaml)).toEqual(['deploy_branch'])
    expect(plan.removals.map(k => k.yaml)).toEqual(['keep_git_dir'])
  })

  it('readGlobalReports reads one report per namespace the table uses', async () => {
    const ctx = setup({
      'builder:report --global --format json': globalJson({ selected: 'dockerfile' }),
      'builder-dockerfile:report --global --format json': globalJson({}),
      'app-json:report --global --format json': globalJson({}),
    })
    expect(await readGlobal(ctx, 'build')).toEqual({ selected: 'dockerfile' })
    expect((ctx.runner.queryStrict as any).mock.calls.map((c: string[]) => c[0])).toEqual(['builder:report', 'builder-dockerfile:report', 'app-json:report'])
  })
})
