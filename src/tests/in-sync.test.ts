// The invariant behind `diff` and `up`: when `diff` says a box is in sync,
// `up` changes nothing. `fixtures/in-sync.yml` declares every resource
// dokku-compose manages; `inSyncServer()` is a server whose state equals it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import { loadConfig } from '../core/config.js'
import { computeDiff, formatSummary, formatVerbose } from '../commands/diff.js'
import { runUp } from '../commands/up.js'
import { fakeContext, report, emptyAnswer, logsAppJson, logsGlobalJson, nginxGlobalJson, serviceInfoJson, type FakeServer } from './fake-server.js'

const FIXTURE = 'src/tests/fixtures/in-sync.yml'
const CRT = fs.readFileSync('src/tests/fixtures/certs/myapp.crt', 'utf8')
const SINK = 'console://?encoding[codec]=json'

/** The reads that look for removed settings on an app whose file declares none of these blocks. */
function nothingSet(name: string): Record<string, string> {
  return {
    [`network:report ${name}`]: report(name, 'network', {}),
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

function inSyncList(): string[] {
  return JSON.parse(inSyncServer().queries['docker-options:report myapp --format json'])['build-list']
}

function inSyncServer(): FakeServer {
  const app = 'myapp'
  const worker = 'myapp-worker'
  const edge = 'myapp-edge'
  return {
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
        APP_ENV: 'production', DOKKU_COMPOSE_MANAGED_KEYS: 'APP_ENV', DATABASE_URL: 'postgres://u:p@h/db',
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
      [`git:report ${app} --git-deploy-branch`]: 'main',

      // myapp-worker: no cert, all checks disabled, its own deploy branch
      [`certs:report ${worker} --ssl-enabled`]: 'false',
      [`checks:report ${worker}`]: report(worker, 'checks', {
        'Checks disabled list': '_all_',
        'Checks skipped list': 'none',
      }),
      [`domains:report ${worker} --domains-app-enabled`]: 'false',
      [`git:report ${worker} --git-deploy-branch`]: 'release',
      [`config:get ${worker} DOKKU_COMPOSE_MANAGED_KEYS`]: '',
      ...nothingSet(worker),

      // myapp-edge: `ssl: true` (any cert) and an installed one
      [`certs:report ${edge} --ssl-enabled`]: 'true',
      [`certs:show ${edge} crt`]: CRT,
      [`config:get ${edge} DOKKU_COMPOSE_MANAGED_KEYS`]: '',
      [`git:report ${edge} --git-deploy-branch`]: 'main',
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
    // The state those commands leave behind: a second run runs nothing.
    const after = JSON.parse(server.queries[key])
    after['build-list'] = inSyncList()
    server.queries[key] = JSON.stringify(after)
    const second = fakeContext(server)
    await runUp(second.ctx, loadConfig(FIXTURE), [])
    expect(second.runner.dryRunLog).toEqual([])
  })

  // Gaps owned by other issues. Each becomes a real assertion when its issue lands.
  it.todo('LAB-757: postgres backup: is read from the server (no hash env var), and an unchanged schedule runs no write')
  it.todo('LAB-751: top-level env: and docker_auth: read first; an in-sync global env or registry login runs no write')
  it.todo('LAB-753: links: options (alias, env_var, querystring) are declared and compared')
})
