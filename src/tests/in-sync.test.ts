// The invariant behind `diff` and `up`: when `diff` says a box is in sync,
// `up` changes nothing. `fixtures/in-sync.yml` declares every resource
// dokku-compose manages; `inSyncServer()` is a server whose state equals it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import { loadConfig } from '../core/config.js'
import { computeDiff, formatVerbose } from '../commands/diff.js'
import { runUp } from '../commands/up.js'
import { fakeContext, report, type FakeServer } from './fake-server.js'

const FIXTURE = 'src/tests/fixtures/in-sync.yml'
const CRT = fs.readFileSync('src/tests/fixtures/certs/myapp.crt', 'utf8')
const SINK = 'console://?encoding[codec]=json'

function inSyncServer(): FakeServer {
  const app = 'myapp'
  const worker = 'myapp-worker'
  return {
    checks: {
      'apps:exists myapp': true,
      'apps:exists myapp-worker': true,
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
      // Global settings
      'domains:report --global --domains-global-vhosts': 'example.com',
      'logs:report --global --format json': JSON.stringify({
        'global-max-size': '50m', 'global-vector-sink': SINK, 'global-app-label-alias': '',
        'computed-max-size': '50m',
      }),
      'nginx:report --global --format json': JSON.stringify({
        'global-client-max-body-size': '20m', 'global-hsts': '',
      }),

      // myapp
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
      [`logs:report ${app} --format json`]: JSON.stringify({
        'max-size': '10m', 'vector-sink': SINK, 'vector-cron-sink': '', 'app-label-alias': '',
        'global-max-size': '50m', 'computed-max-size': '10m',
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
      [`git:report ${worker} --git-deploy-branch`]: 'release',
      [`config:get ${worker} DOKKU_COMPOSE_MANAGED_KEYS`]: '',
      // Blocks the file leaves out are read once to look for removed settings.
      [`network:report ${worker}`]: report(worker, 'network', {}),
      [`nginx:report ${worker}`]: report(worker, 'nginx', {}),
      [`logs:report ${worker} --format json`]: JSON.stringify({ 'max-size': '', 'global-max-size': '50m' }),
      [`registry:report ${worker}`]: report(worker, 'registry', {}),
      [`scheduler:report ${worker}`]: report(worker, 'scheduler', {}),
      [`ps:report ${worker} --format json`]: JSON.stringify({ 'restart-policy': '' }),
      [`builder:report ${worker}`]: report(worker, 'builder', {}),
      [`builder-dockerfile:report ${worker}`]: report(worker, 'builder-dockerfile', {}),
      [`app-json:report ${worker}`]: report(worker, 'app-json', {}),
      [`docker-options:report ${worker}`]: report(worker, 'docker-options', {}),
      [`docker-options:report ${worker} --format json`]: JSON.stringify({ 'build-list': [] }),
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

  // Gaps owned by other issues. Each becomes a real assertion when its issue lands.
  it.todo('LAB-750: postgres:/redis: version and image are compared with the server, and diff shows a change')
  it.todo('LAB-757: postgres backup: is read from the server (no hash env var), and an unchanged schedule runs no write')
  it.todo('LAB-751: top-level env: and docker_auth: read first; an in-sync global env or registry login runs no write')
  it.todo('LAB-753: links: options (alias, env_var, querystring) are declared and compared')
})
