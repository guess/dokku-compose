// The invariant behind `diff` and `up`: when `diff` says a box is in sync,
// `up` changes nothing. `fixtures/in-sync.yml` declares every resource
// dokku-compose manages; `inSyncServer()` is a server whose state equals it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import { loadConfig } from '../core/config.js'
import { computeDiff, formatSummary, formatVerbose } from '../commands/diff.js'
import { runUp } from '../commands/up.js'
import { fakeContext, report, emptyAnswer, gitReport, logsAppJson, logsGlobalJson, nginxGlobalJson, serviceInfoJson, type FakeServer } from './fake-server.js'

const FIXTURE = 'src/tests/fixtures/in-sync.yml'
const CRT = fs.readFileSync('src/tests/fixtures/certs/myapp.crt', 'utf8')
const SINK = 'console://?encoding[codec]=json'

/** The reads that look for removed settings on an app whose file declares none of these blocks. */
function nothingSet(name: string): Record<string, string> {
  return {
    [`network:report ${name}`]: report(name, 'network', {}),
    [`proxy:report ${name}`]: report(name, 'proxy', { 'Proxy enabled': 'true' }),
    [`nginx:report ${name}`]: report(name, 'nginx', {}),
    [`logs:report ${name} --format json`]: logsAppJson({ 'global-max-size': '50m', 'logs-global-max-size': '50m', 'computed-max-size': '50m' }),
    [`registry:report ${name}`]: report(name, 'registry', {}),
    [`scheduler:report ${name}`]: report(name, 'scheduler', {}),
    [`ps:report ${name} --format json`]: JSON.stringify({ 'restart-policy': '' }),
    [`builder:report ${name}`]: report(name, 'builder', {}),
    [`builder-dockerfile:report ${name}`]: report(name, 'builder-dockerfile', {}),
    [`app-json:report ${name}`]: report(name, 'app-json', {}),
    [`docker-options:report ${name}`]: report(name, 'docker-options', {}),
    [`docker-options:report ${name} --format json`]: JSON.stringify({ 'build-list': [] }),
  }
}

function inSyncServer(): FakeServer {
  const app = 'myapp'
  const worker = 'myapp-worker'
  const edge = 'myapp-edge'
  return {
    statuses: {
      'registry:auth-status --global --password-stdin registry.example.com bot': 0,
    },
    checks: {
      'apps:exists myapp': true,
      'apps:exists myapp-worker': true,
      'apps:exists myapp-edge': true,
      'postgres:linked myapp-db myapp-edge': false,
      'redis:linked myapp-redis myapp-edge': false,
      'network:exists backend-net': true,
      'postgres:exists myapp-db': true,
      'redis:exists myapp-redis': true,
      'postgres:linked myapp-db myapp': true,
      'postgres:exists myapp-reports': true,
      'postgres:linked myapp-reports myapp': true,
      'postgres:linked myapp-reports myapp-worker': false,
      'postgres:linked myapp-reports myapp-edge': false,
      'redis:linked myapp-redis myapp': true,
      'postgres:linked myapp-db myapp-worker': false,
      'redis:linked myapp-redis myapp-worker': false,
    },
    queries: {
      'version': 'dokku version 0.38.31',
      'plugin:list --format json': JSON.stringify([
        { name: 'postgres', version: '2.4.0', committish: '2.4.0', enabled: true, core: false },
        { name: 'redis', version: '2.4.0', committish: '2.4.0', enabled: true, core: false },
      ]),
      'postgres:info myapp-db --format json': serviceInfoJson('myapp-db', 'postgis/postgis', '17-3.5'),
      'redis:info myapp-redis --format json': serviceInfoJson('myapp-redis', 'redis', '7.2-alpine'),
      // Global settings
      'domains:report --global --domains-global-vhosts': 'example.com',
      'logs:report --global --format json': logsGlobalJson({
        'global-max-size': '50m', 'logs-global-max-size': '50m', 'computed-max-size': '50m', 'logs-computed-max-size': '50m',
        'global-vector-sink': SINK, 'logs-global-vector-sink': SINK, 'computed-vector-sink': SINK, 'logs-computed-vector-sink': SINK,
      }),
      'nginx:report --global --format json': nginxGlobalJson({ 'global-client-max-body-size': '20m' }),
      // Global env as config:export --global prints it: a hand-set key and an old backup hash beside the managed ones.
      'config:export --global --format json': JSON.stringify({
        TZ: 'UTC', FEATURE_X: 'true', DOKKU_COMPOSE_GLOBAL_MANAGED_KEYS: 'TZ,FEATURE_X',
        HAND_SET: 'x', DOKKU_COMPOSE_BACKUP_HASH_MYAPP_DB: 'abc123',
      }),
      'registry:report --global --registry-global-auth-servers': 'registry.example.com',

      // myapp
      [`domains:report ${app} --domains-app-enabled`]: 'true',
      [`domains:report ${app} --domains-app-vhosts`]: 'myapp.example.com www.myapp.example.com',
      [`network:report ${app} --network-attach-post-deploy`]: 'backend-net',
      [`network:report ${app}`]: report(app, 'network', {
        'Network attach post create': 'backend-net',
        'Network attach post deploy': 'backend-net',
        'Network bind all interfaces': 'true',
        'Network initial network': 'bridge',
        'Network tld': 'internal',
      }),
      [`proxy:report ${app} --proxy-enabled`]: 'true',
      [`proxy:report ${app}`]: report(app, 'proxy', { 'Proxy enabled': 'true' }),
      [`ports:report ${app} --ports-map`]: 'http:80:5000 https:443:5000',
      [`certs:report ${app} --ssl-enabled`]: 'true',
      [`certs:show ${app} crt`]: CRT,
      [`storage:report ${app} --storage-deploy-mounts`]: '-v /var/lib/dokku/data/storage/myapp/uploads:/app/uploads',
      [`nginx:report ${app}`]: report(app, 'nginx', {
        'Nginx client max body size': '15m',
        'Nginx global client max body size': '20m',
        'Nginx computed client max body size': '15m',
      }),
      [`checks:report ${app}`]: report(app, 'checks', {
        'Checks disabled list': 'worker',
        'Checks skipped list': 'release',
        'Checks wait to retire': '60',
        'Checks computed wait to retire': '60',
      }),
      [`logs:report ${app} --format json`]: logsAppJson({
        'max-size': '10m', 'logs-max-size': '10m', 'vector-sink': SINK, 'logs-vector-sink': SINK,
        'computed-max-size': '10m', 'logs-computed-max-size': '10m', 'global-max-size': '50m', 'logs-global-max-size': '50m',
        'computed-app-label-alias': 'com.dokku.app-name', 'logs-computed-app-label-alias': 'com.dokku.app-name',
      }),
      [`registry:report ${app}`]: report(app, 'registry', { 'Registry server': 'registry.example.com' }),
      [`scheduler:report ${app}`]: report(app, 'scheduler', { 'Scheduler selected': 'docker-local' }),
      [`ps:report ${app} --format json`]: JSON.stringify({
        'restart-policy': 'on-failure:10', 'stop-timeout-seconds': '60', 'procfile-path': '', deployed: 'true',
      }),
      [`ps:scale --format json ${app}`]: JSON.stringify([
        { process_type: 'web', quantity: 2 }, { process_type: 'worker', quantity: 1 },
      ]),
      [`config:get ${app} DOKKU_COMPOSE_MANAGED_KEYS`]: 'APP_ENV',
      [`config:export --format json ${app}`]: JSON.stringify({
        APP_ENV: 'production', DOKKU_COMPOSE_MANAGED_KEYS: 'APP_ENV', DATABASE_URL: 'postgres://u:p@dokku-postgres-myapp-db:5432/db', CACHE_URL: 'redis://:p@dokku-redis-myapp-redis:6379?timeout=5',
        DOKKU_POSTGRES_AQUA_URL: 'postgres://u:p@dokku-postgres-myapp-reports:5432/db',
      }),
      [`builder:report ${app}`]: report(app, 'builder', { 'Builder build dir': 'apps/myapp' }),
      [`builder-dockerfile:report ${app}`]: report(app, 'builder-dockerfile', {
        'Builder dockerfile dockerfile path': 'docker/Dockerfile',
      }),
      [`app-json:report ${app}`]: report(app, 'app-json', { 'App json selected': 'docker/app.json' }),
      [`docker-options:report ${app}`]: report(app, 'docker-options', {
        'Docker options build': '--build-arg NODE_ENV=production --link dokku.postgres.myapp-db:dokku-postgres-myapp-db',
        'Docker options deploy': '--shm-size 256m --link dokku.postgres.myapp-db:dokku-postgres-myapp-db',
        'Docker options run': '--ulimit nofile=12',
      }),
      // Stored as Dokku keeps them: values with a space or `?` are shell-quoted.
      [`docker-options:report ${app} --format json`]: JSON.stringify({
        'build-list': [
          '--build-arg NODE_ENV=production',
          "--build-arg 'GREETING=hello big world'",
          "--build-arg 'API_URL=https://api.example.com/v1?debug=1'",
          '--link dokku.postgres.myapp-db:dokku-postgres-myapp-db',
        ],
        'deploy-list': ['--shm-size 256m'],
      }),
      [`git:report ${app}`]: gitReport(app, { 'Git deploy branch': 'main' }),

      // myapp-worker: no cert, all checks disabled, its own deploy branch
      [`certs:report ${worker} --ssl-enabled`]: 'false',
      [`checks:report ${worker}`]: report(worker, 'checks', {
        'Checks disabled list': '_all_',
        'Checks skipped list': 'none',
      }),
      [`domains:report ${worker} --domains-app-enabled`]: 'false',
            [`git:report ${worker}`]: gitReport(worker, { 'Git deploy branch': 'release' }),
      [`config:get ${worker} DOKKU_COMPOSE_MANAGED_KEYS`]: '',
      ...nothingSet(worker),

      // myapp-edge: `ssl: true` (any cert) and an installed one
      [`certs:report ${edge} --ssl-enabled`]: 'true',
      [`certs:show ${edge} crt`]: CRT,
      [`config:get ${edge} DOKKU_COMPOSE_MANAGED_KEYS`]: '',
      [`git:report ${edge}`]: gitReport(edge, { 'Git deploy branch': 'main' }),
      [`checks:report ${edge}`]: report(edge, 'checks', { 'Checks disabled list': 'none', 'Checks skipped list': 'none' }),
      ...nothingSet(edge),
    },
  }
}

describe('a server whose state equals the file', () => {
  let log: ReturnType<typeof vi.spyOn>
  beforeEach(() => { log = vi.spyOn(console, 'log').mockImplementation(() => {}) })
  afterEach(() => { log.mockRestore() })

  it('diff reports it in sync', async () => {
    const { ctx } = fakeContext(inSyncServer())
    const diff = await computeDiff(ctx, loadConfig(FIXTURE))
    const drift = Object.entries(diff.apps).flatMap(([app, features]) =>
      Object.entries(features).filter(([, d]) => d.status !== 'in-sync').map(([f, d]) => `${app}/${f}: ${d.status}`))
    expect(drift).toEqual([])
    expect(diff.readWarnings).toEqual([])
    expect(diff.inSync).toBe(true)
    expect(formatVerbose(diff)).toContain('Everything in sync.')
  })

  it('up --dry-run runs no command', async () => {
    const { ctx, runner } = fakeContext(inSyncServer())
    await runUp(ctx, loadConfig(FIXTURE), [])
    expect(runner.dryRunLog).toEqual([])
  })

  it('up --dry-run --prune runs no command', async () => {
    const { ctx, runner } = fakeContext(inSyncServer())
    await runUp(ctx, loadConfig(FIXTURE), [], { prune: true })
    expect(runner.dryRunLog).toEqual([])
  })

  it('an app whose domains are enabled but declared false shows in diff, and up disables exactly it', async () => {
    const server = inSyncServer()
    server.queries['domains:report myapp-worker --domains-app-enabled'] = 'true'
    server.queries['domains:report myapp-worker --domains-app-vhosts'] = 'w.example.com'
    const { ctx, runner } = fakeContext(server)
    const diff = await computeDiff(ctx, loadConfig(FIXTURE))
    expect(diff.apps['myapp-worker'].domains).toMatchObject({ status: 'changed', desired: false, current: ['w.example.com'] })
    const second = fakeContext(server)
    await runUp(second.ctx, loadConfig(FIXTURE), [])
    expect(second.runner.dryRunLog).toEqual(['domains:disable myapp-worker'])
    expect(runner.dryRunLog).toEqual([])
  })

  it('a global domain that differs shows in diff, and up sets exactly that', async () => {
    const server = inSyncServer()
    server.queries['domains:report --global --domains-global-vhosts'] = 'old.example.com'
    const diff = await computeDiff(fakeContext(server).ctx, loadConfig(FIXTURE))
    expect(diff.global.domains).toMatchObject({ status: 'changed', current: ['old.example.com'] })
    expect(diff.inSync).toBe(false)
    const { ctx, runner } = fakeContext(server)
    await runUp(ctx, loadConfig(FIXTURE), [])
    expect(runner.dryRunLog).toEqual(['domains:set-global example.com'])
  })

  it('a service whose version or image differs shows in diff, and up warns and runs no :upgrade', async () => {
    const server = inSyncServer()
    server.queries['postgres:info myapp-db --format json'] = serviceInfoJson('myapp-db', 'postgres', '16.1')
    server.queries['redis:info myapp-redis --format json'] = serviceInfoJson('myapp-redis', 'redis', '7.0-alpine')
    const diff = await computeDiff(fakeContext(server).ctx, loadConfig(FIXTURE))
    expect(diff.services['myapp-db']).toMatchObject({
      status: 'changed',
      mismatches: [
        { field: 'version', desired: '17-3.5', current: '16.1' },
        { field: 'image', desired: 'postgis/postgis', current: 'postgres' },
      ],
    })
    expect(diff.services['myapp-redis']).toMatchObject({ status: 'changed', mismatches: [{ field: 'version', desired: '7.2-alpine', current: '7.0-alpine' }] })
    expect(diff.inSync).toBe(false)
    expect(formatSummary(diff)).toContain('version: 16.1 → 17-3.5')
    expect(formatSummary(diff).match(/services: myapp-db/g)).toHaveLength(1)
    expect(formatVerbose(diff)).toContain('- 16.1')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { ctx, runner } = fakeContext(server)
    await runUp(ctx, loadConfig(FIXTURE), [])
    expect(runner.dryRunLog).toEqual([])
    const warned = warn.mock.calls.map(c => String(c[0])).filter(l => l.includes('on the server but'))
    expect(warned).toHaveLength(2)
    expect(warned[0]).toContain('myapp-db: version is 16.1 on the server but 17-3.5 in the file; image is postgres on the server but postgis/postgis in the file')
    warn.mockRestore()
  })

  it('a removed global key and a changed registry password show in diff without values, and up fixes exactly those', async () => {
    const server = inSyncServer()
    server.queries['config:export --global --format json'] = JSON.stringify({
      TZ: 'UTC', FEATURE_X: 'true', OLD_FLAG: 'secret-value', DOKKU_COMPOSE_GLOBAL_MANAGED_KEYS: 'TZ,FEATURE_X,OLD_FLAG', HAND_SET: 'x',
    })
    server.statuses!['registry:auth-status --global --password-stdin registry.example.com bot'] = 2
    server.queries['registry:report --global --registry-global-auth-servers'] = 'old.example.com,registry.example.com'
    const diff = await computeDiff(fakeContext(server).ctx, loadConfig(FIXTURE))
    expect(diff.global.env).toMatchObject({ status: 'extra', removed: ['OLD_FLAG'] })
    expect(diff.global.docker_auth).toMatchObject({ status: 'changed', removed: ['old.example.com'] })
    expect(diff.inSync).toBe(false)
    const shown = formatVerbose(diff)
    expect(shown).not.toContain('secret-value')
    expect(shown).not.toContain('s3cret')
    expect(shown).not.toContain('DOKKU_COMPOSE_GLOBAL_MANAGED_KEYS')

    const up = fakeContext(server)
    await runUp(up.ctx, loadConfig(FIXTURE), [])
    expect(up.runner.dryRunLog).toEqual([
      'registry:login --global --password-stdin registry.example.com bot',
      'config:unset --global OLD_FLAG',
      'config:set --global DOKKU_COMPOSE_GLOBAL_MANAGED_KEYS=TZ,FEATURE_X',
    ])

    const pruned = fakeContext(server)
    await runUp(pruned.ctx, loadConfig(FIXTURE), [], { prune: true })
    expect(pruned.runner.dryRunLog).toContain('registry:logout --global old.example.com')
  })

  it('several build args, one changed and one added: up runs remove-old + add-new + add-added, then nothing', async () => {
    const server = inSyncServer()
    const key = 'docker-options:report myapp --format json'
    const list = JSON.parse(server.queries[key])
    list['build-list'] = list['build-list'].map((o: string) => o === '--build-arg NODE_ENV=production' ? '--build-arg NODE_ENV=staging' : o)
      .filter((o: string) => !o.includes('API_URL'))
    server.queries[key] = JSON.stringify(list)
    const { ctx, runner } = fakeContext(server)
    await runUp(ctx, loadConfig(FIXTURE), [])
    expect(runner.dryRunLog).toEqual([
      "docker-options:remove myapp build '--build-arg NODE_ENV=staging'",
      "docker-options:add myapp build '--build-arg NODE_ENV=production'",
      "docker-options:add myapp build '--build-arg '\\''API_URL=https://api.example.com/v1?debug=1'\\'''",
    ])
    // Apply the logged commands to the fake build-list: add appends, remove drops the matching entry.
    const canon = (t: string) => t.replace(/^'(.*)'$/s, '$1').replace(/'\\''/g, "'")
    const stored: string[] = JSON.parse(server.queries[key])['build-list']
    for (const cmd of runner.dryRunLog) {
      const m = cmd.match(/^docker-options:(add|remove) myapp build (.*)$/s)
      if (!m) continue
      const opt = canon(m[2])
      const norm = (o: string) => o.replace(/'/g, '')
      if (m[1] === 'add') stored.push(opt)
      else {
        const i = stored.findIndex(o => norm(o) === norm(opt))
        if (i < 0) throw new Error(`remove matched no stored option: ${opt}`)
        stored.splice(i, 1)
      }
    }
    server.queries[key] = JSON.stringify({ ...JSON.parse(server.queries[key]), 'build-list': stored })
    const second = fakeContext(server)
    await runUp(second.ctx, loadConfig(FIXTURE), [])
    expect(second.runner.dryRunLog).toEqual([])
    const keys = stored.filter(o => o.startsWith('--build-arg ')).map(o => o.replace(/^--build-arg '?([^=]+)=.*$/s, '$1'))
    expect(keys.sort()).toEqual([...new Set(keys)].sort())
  })

  it('a changed global key lists every processed app for restart; an unchanged run lists none', async () => {
    const same = fakeContext(inSyncServer())
    await runUp(same.ctx, loadConfig(FIXTURE), [])
    expect([...same.ctx.restarts.keys()]).toEqual([])

    const server = inSyncServer()
    server.queries['config:export --global --format json'] = JSON.stringify({
      TZ: 'Europe/Paris', FEATURE_X: 'true', DOKKU_COMPOSE_GLOBAL_MANAGED_KEYS: 'TZ,FEATURE_X',
    })
    const changed = fakeContext(server)
    await runUp(changed.ctx, loadConfig(FIXTURE), ['myapp', 'myapp-edge'])
    expect(changed.runner.dryRunLog).toContain('config:set --global TZ=UTC')
    expect([...changed.ctx.restarts.keys()].sort()).toEqual(['myapp', 'myapp-edge'])
  })

  it('removing the env: block unsets the marked global keys and drops the marker', async () => {
    const config = loadConfig(FIXTURE)
    delete config.env
    const diff = await computeDiff(fakeContext(inSyncServer()).ctx, config)
    expect(diff.global.env).toMatchObject({ removed: ['TZ', 'FEATURE_X'] })
    const { ctx, runner } = fakeContext(inSyncServer())
    await runUp(ctx, config, [])
    expect(runner.dryRunLog).toEqual(['config:unset --global TZ FEATURE_X DOKKU_COMPOSE_GLOBAL_MANAGED_KEYS'])
  })

  it('a link with alias and querystring that matches the server runs no command; a different querystring relinks', async () => {
    const server = inSyncServer()
    const { ctx, runner } = fakeContext(server)
    await runUp(ctx, loadConfig(FIXTURE), [])
    expect(runner.dryRunLog).toEqual([])
    server.queries['config:export --format json myapp'] = JSON.stringify({
      APP_ENV: 'production', DOKKU_COMPOSE_MANAGED_KEYS: 'APP_ENV', DATABASE_URL: 'postgres://u:p@dokku-postgres-myapp-db:5432/db', CACHE_URL: 'redis://:p@dokku-redis-myapp-redis:6379?timeout=9', DOKKU_POSTGRES_AQUA_URL: 'postgres://u:p@dokku-postgres-myapp-reports:5432/db',
    })
    const diff = await computeDiff(fakeContext(server).ctx, loadConfig(FIXTURE))
    expect(diff.apps.myapp['links:myapp-redis']).toMatchObject({ status: 'changed', current: 'CACHE_URL?timeout=9', desired: 'CACHE_URL?timeout=5' })
    const second = fakeContext(server)
    await runUp(second.ctx, loadConfig(FIXTURE), [])
    expect(second.runner.dryRunLog).toEqual([
      'redis:unlink myapp-redis myapp --no-restart',
      'redis:link myapp-redis myapp --no-restart --alias CACHE --querystring timeout=5',
    ])
  })

  it('a declared link that is not linked shows as missing in diff', async () => {
    const server = inSyncServer()
    server.checks['redis:linked myapp-redis myapp'] = false
    const diff = await computeDiff(fakeContext(server).ctx, loadConfig(FIXTURE))
    expect(diff.apps.myapp['links:myapp-redis']).toMatchObject({ status: 'missing', desired: 'CACHE_URL' })
    expect(diff.inSync).toBe(false)
  })

  // Gaps owned by other issues. Each becomes a real assertion when its issue lands.
  it.todo('LAB-757: postgres backup: is read from the server (no hash env var), and an unchanged schedule runs no write')
})
