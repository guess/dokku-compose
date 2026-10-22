// Every settable property of Dokku 0.38.31, per namespace. The key sets in
// fixtures/dokku-0.38.31/settable-keys.json come from Dokku's own source, so a key
// added to or dropped from a list here (or by a Dokku upgrade) fails these tests.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { reconcile } from '../core/reconcile.js'
import { parseConfig } from '../core/schema.js'
import { NGINX_KEYS, LOGS_KEYS, LOGS_GLOBAL_KEYS, REGISTRY_KEYS, SCHEDULER_KEYS, Registry, Scheduler } from '../resources/properties.js'
import { PS_KEYS, Ps } from '../resources/ps.js'
import { NETWORK_KEYS, NetworkProps } from '../resources/network.js'
import { PROXY_KEYS, ProxyProps } from '../resources/toggle.js'
import { BUILDER_KEYS, Builder } from '../resources/builder.js'
import { GIT_KEYS, Git } from '../resources/git.js'
import { CHECKS_KEYS } from '../resources/checks.js'
import { gitReport } from './fake-server.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/dokku-0.38.31/settable-keys.json', import.meta.url), 'utf8'))
const sorted = (keys: readonly string[]) => [...keys].sort()

describe('property lists equal the keys Dokku 0.38.31 accepts', () => {
  it.each([
    ['nginx', NGINX_KEYS],
    ['logs', LOGS_KEYS],
    ['ps', PS_KEYS],
    ['network', NETWORK_KEYS],
    ['proxy', PROXY_KEYS],
    ['scheduler', SCHEDULER_KEYS],
    ['builder', BUILDER_KEYS],
    ['git', GIT_KEYS],
    ['registry', REGISTRY_KEYS],
    ['checks', CHECKS_KEYS],
  ] as const)('%s (app scope)', (ns, list) => {
    expect(sorted(list)).toEqual(sorted(fixture[ns].app))
  })

  it('the global logs list adds the two global-only keys', () => {
    expect(sorted(LOGS_GLOBAL_KEYS)).toEqual(sorted(fixture.logs.global))
  })

  it('a report-only key is in no list', () => {
    expect(REGISTRY_KEYS).not.toContain('auth-servers')
    expect(BUILDER_KEYS).not.toContain('detected')
    for (const ns of Object.keys(fixture).filter(k => fixture[k].reportOnly)) {
      expect(fixture[ns].app).not.toEqual(expect.arrayContaining(fixture[ns].reportOnly))
    }
  })
})

function ctxWith(reports: Record<string, string>) {
  const runner = createRunner({ dryRun: false })
  runner.query = vi.fn(async (...a: string[]) => reports[a.join(' ')] ?? '')
  runner.queryStrict = runner.query
  runner.run = vi.fn(async () => {})
  return createContext(runner)
}

const withApp = (apps: object, extra: object = {}) => ({ apps, ...extra })

describe('validate: the schema takes exactly what Dokku takes', () => {
  it('accepts each F5 key', () => {
    const app = {
      nginx: { 'nginx-conf-sigil-path': '/etc/x', 'nginx-service-command': 'nginx -g' },
      ps: { restore: false, 'skip-deploy': true, 'start-cmd': 'node x', 'dockerfile-start-cmd': 'node y' },
      network: { static_web_listener: '127.0.0.1:80' },
      proxy: { type: 'caddy', proxy_port: 80, proxy_ssl_port: '443' },
      scheduler: { selected: 'docker-local', shell: '/bin/sh' },
      build: { selected: 'dockerfile', skip_cleanup: true },
      git: { keep_git_dir: true, rev_env_var: 'REV', source_image: 'img', archive_max_files: 5, archive_max_size: '10' },
      checks: { 'wait-to-retire': 30 },
    }
    expect(() => parseConfig(withApp({ myapp: app }, { logs: { 'vector-image': 'v', 'vector-networks': 'n' } }))).not.toThrow()
  })

  it('rejects a checks key Dokku refuses', () => {
    expect(() => parseConfig(withApp({ myapp: { checks: { attempts: 5 } } }))).toThrow()
  })

  it('rejects registry auth-servers, which registry:set refuses', () => {
    expect(() => parseConfig(withApp({ myapp: { registry: { 'auth-servers': 'x' } } }))).toThrow(/auth-servers/)
  })

  it('rejects an unknown nginx or logs key, and a global-only logs key on an app', () => {
    expect(() => parseConfig(withApp({ myapp: { nginx: { bogus: '1' } } }))).toThrow(/bogus/)
    expect(() => parseConfig(withApp({ myapp: { logs: { 'vector-image': 'v' } } }))).toThrow(/vector-image/)
  })

  it('still takes the string form of scheduler', () => {
    expect(parseConfig(withApp({ myapp: { scheduler: 'k3s' } })).apps.myapp.scheduler).toBe('k3s')
  })
})

describe('new keys are read, set and pruned', () => {
  it('registry: auth-servers is never a removal nor passed to registry:set', async () => {
    const ctx = ctxWith({ 'registry:report myapp': '       Registry auth servers: ghcr.io\n       Registry server: reg.example.com\n' })
    await reconcile(Registry, ctx, 'myapp', undefined, undefined, true)
    expect(ctx.commands).toEqual([['registry:set', 'myapp', 'server']])
  })

  it('ps: restore reported as its default true is not a removal; a changed one is', async () => {
    const dflt = ctxWith({ 'ps:report myapp --format json': JSON.stringify({ restore: 'true', 'start-cmd': '' }) })
    await reconcile(Ps, dflt, 'myapp', undefined, undefined, true)
    expect(dflt.commands).toEqual([])
    const off = ctxWith({ 'ps:report myapp --format json': JSON.stringify({ restore: 'false', 'start-cmd': 'node x', 'skip-deploy': 'true' }) })
    await reconcile(Ps, off, 'myapp', { 'skip-deploy': true }, undefined, true)
    expect(off.commands).toEqual([['ps:set', 'myapp', 'restore'], ['ps:set', 'myapp', 'start-cmd']])
  })

  it('ps: a declared restore: true is in sync when the server prints the default', async () => {
    const ctx = ctxWith({ 'ps:report myapp --format json': JSON.stringify({ restore: 'true' }) })
    await reconcile(Ps, ctx, 'myapp', { restore: true })
    expect(ctx.commands).toEqual([])
  })

  it('network: static_web_listener is set and pruned', async () => {
    const set = ctxWith({ 'network:report myapp': '' })
    await reconcile(NetworkProps, set, 'myapp', { static_web_listener: '127.0.0.1:80' })
    expect(set.commands).toEqual([['network:set', 'myapp', 'static-web-listener', '127.0.0.1:80']])
    const prune = ctxWith({ 'network:report myapp': '       Network static web listener: 127.0.0.1:80\n' })
    await reconcile(NetworkProps, prune, 'myapp', undefined, undefined, true)
    expect(prune.commands).toEqual([['network:set', 'myapp', 'static-web-listener']])
  })

  it('proxy: type and ports are set, and the ones left out are pruned', async () => {
    const report = '       Proxy enabled: true\n       Proxy type: caddy\n       Proxy proxy port: 8080\n       Proxy proxy ssl port: 8443\n'
    const ctx = ctxWith({ 'proxy:report myapp': report })
    await reconcile(ProxyProps, ctx, 'myapp', { type: 'caddy', proxy_port: 80 }, undefined, true)
    expect(ctx.commands).toEqual([
      ['proxy:set', 'myapp', 'proxy-port', '80'],
      ['proxy:set', 'myapp', 'proxy-ssl-port'],
    ])
  })

  it('scheduler: shell is set and pruned beside selected', async () => {
    const set = ctxWith({ 'scheduler:report myapp': '       Scheduler selected: docker-local\n' })
    await reconcile(Scheduler, set, 'myapp', { selected: 'docker-local', shell: '/bin/bash' })
    expect(set.commands).toEqual([['scheduler:set', 'myapp', 'shell', '/bin/bash']])
    const prune = ctxWith({ 'scheduler:report myapp': '       Scheduler selected: docker-local\n       Scheduler shell: /bin/bash\n' })
    await reconcile(Scheduler, prune, 'myapp', 'docker-local', undefined, true)
    expect(prune.commands).toEqual([['scheduler:set', 'myapp', 'shell']])
  })

  it('builder: selected and skip_cleanup are set and pruned', async () => {
    const reports = (b: string) => ({
      'builder:report myapp': b, 'builder-dockerfile:report myapp': '', 'app-json:report myapp': '',
      'docker-options:report myapp --format json': JSON.stringify({ 'build-list': [] }),
    })
    const set = ctxWith(reports(''))
    await reconcile(Builder, set, 'myapp', { selected: 'dockerfile', skip_cleanup: true })
    expect(set.commands).toEqual([['builder:set', 'myapp', 'selected', 'dockerfile'], ['builder:set', 'myapp', 'skip-cleanup', 'true']])
    const prune = ctxWith(reports('       Builder selected: pack\n       Builder skip cleanup: true\n       Builder detected: dockerfile\n'))
    await reconcile(Builder, prune, 'myapp', { dockerfile: 'Dockerfile' }, undefined, true)
    expect(prune.commands).toEqual([
      ['builder-dockerfile:set', 'myapp', 'dockerfile-path', 'Dockerfile'],
      ['builder:set', 'myapp', 'selected'], ['builder:set', 'myapp', 'skip-cleanup'],
    ])
  })

  it('git: the five new keys are set; an unset rev-env-var (printed as GIT_REV) and the computed limits are not removals', async () => {
    const set = ctxWith({ 'git:report myapp': gitReport('myapp') })
    await reconcile(Git, set, 'myapp', {
      keep_git_dir: true, rev_env_var: 'REV', source_image: 'img', archive_max_files: 5, archive_max_size: '10',
    })
    expect(set.commands).toEqual([
      ['git:set', 'myapp', 'keep-git-dir', 'true'], ['git:set', 'myapp', 'source-image', 'img'],
      ['git:set', 'myapp', 'rev-env-var', 'REV'], ['git:set', 'myapp', 'archive-max-files', '5'],
      ['git:set', 'myapp', 'archive-max-size', '10'],
    ])
    const quiet = ctxWith({ 'git:report myapp': gitReport('myapp') })
    await reconcile(Git, quiet, 'myapp', undefined, undefined, true)
    expect(quiet.commands).toEqual([])
    const stale = ctxWith({ 'git:report myapp': gitReport('myapp', { 'Git keep git dir': 'true', 'Git source image': 'img' }) })
    await reconcile(Git, stale, 'myapp', { archive_max_files: 10000 }, undefined, true)
    expect(stale.commands).toEqual([['git:set', 'myapp', 'keep-git-dir'], ['git:set', 'myapp', 'source-image']])
  })
})
