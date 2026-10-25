// The invariant behind `diff` and `up`: when `diff` says a box is in sync,
// `up` changes nothing. `fixtures/in-sync.yml` declares every resource
// dokku-compose manages; `inSyncServer()` is a server whose state equals it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import { createHash } from 'crypto'
import { loadConfig } from '../core/config.js'
import { computeDiff, formatSummary, formatVerbose, maskDiffResult } from '../commands/diff.js'
import { runUp } from '../commands/up.js'
import { fakeContext, report, emptyAnswer, gitReport, proxyReport, storageReportJson, logsAppJson, logsGlobalJson, nginxGlobalJson, globalReportJson, serviceInfoJson, type FakeServer } from './fake-server.js'
import { maskSensitiveArgs } from '../core/mask.js'
import { fakeContext, report, emptyAnswer, gitReport, proxyReport, storageReportJson, logsAppJson, logsGlobalJson, nginxGlobalJson, serviceInfoJson, type FakeServer } from './fake-server.js'

const FIXTURE = 'src/tests/fixtures/in-sync.yml'
const CRT = fs.readFileSync('src/tests/fixtures/certs/myapp.crt', 'utf8')
const SINK = 'console://?encoding[codec]=json'
/** `git:report <app>` rows of an app with no git settings of its own: it computes the global ones. */
const INHERITED_GIT = {
  'Git global deploy branch': 'main', 'Git computed deploy branch': 'main',
  'Git global keep git dir': 'true', 'Git computed keep git dir': 'true',
  'Git global archive max files': '20000', 'Git computed archive max files': '20000',
}

/** The reads that look for removed settings on an app whose file declares none of these blocks. */
function nothingSet(name: string): Record<string, string> {
  return {
    [`network:report ${name}`]: report(name, 'network', {}),
    [`proxy:report ${name}`]: proxyReport(name),
    [`nginx:report ${name}`]: report(name, 'nginx', {}),
    [`logs:report ${name} --format json`]: logsAppJson({ 'global-max-size': '50m', 'logs-global-max-size': '50m', 'computed-max-size': '50m' }),
    [`registry:report ${name}`]: report(name, 'registry', {}),
    [`scheduler:report ${name}`]: report(name, 'scheduler', {}),
    [`ps:report ${name} --format json`]: JSON.stringify({ 'restart-policy': '', restore: 'false' }),
    [`builder:report ${name}`]: report(name, 'builder', {}),
    [`builder-dockerfile:report ${name}`]: report(name, 'builder-dockerfile', {}),
    [`app-json:report ${name}`]: report(name, 'app-json', {}),
    [`docker-options:report ${name}`]: report(name, 'docker-options', {}),
    [`docker-options:report ${name} --format json`]: JSON.stringify({ 'build-list': [] }),
  }
}

// printf 'KEY\nSECRET' | shasum -a 256
const KEY_FINGERPRINT = '367b0dd6299da53d84c87a01b0519aed571f65b54ed7d95687fbbaf6760462b3'
const AUTHENTICATED = {
  'backup-authenticated': 'true', 'backup-auth-fingerprint': KEY_FINGERPRINT,
  'backup-default-region': 'auto', 'backup-signature-version': 's3v4', 'backup-endpoint-url': 'https://s3.example.com',
}
// sha256 of 'in-sync-passphrase', no newline
const PASSPHRASE_FINGERPRINT = createHash('sha256').update('in-sync-passphrase').digest('hex')
const REDIS_BACKUP = {
  ...AUTHENTICATED, 'backup-schedule': '0 * * * *', 'backup-bucket': 'backups/myapp-redis',
  'backup-encryption-fingerprint': PASSPHRASE_FINGERPRINT, 'backup-encrypted': 'true',
  'backup-storage-class': 'STANDARD_IA', 'backup-object-name': 'cache/latest', 'backup-mailto': 'ops@example.com', 'backup-timestamp': 'false',
}
const REPORTS_BACKUP = {
  ...AUTHENTICATED, 'backup-schedule': '30 2 * * *', 'backup-bucket': 'backups/myapp-reports',
  'backup-public-key-id': 'ABCD1234ABCD1234', 'backup-keyserver': 'hkp://keys.example.com', 'backup-encrypted': 'true',
}

// sha256 of 'Zq7-Hk9vbn2', no newline
const PASSWORD_FINGERPRINT = createHash('sha256').update('Zq7-Hk9vbn2').digest('hex')
// As the plugins report the properties and mounts the fixture declares (lists in the server's order, mounts normalised).
const DB_PROPERTIES = {
  memory: '512', 'shm-size': '256m', 'restart-policy': 'unless-stopped', 'post-create-network': 'other-net,backend-net',
  'custom-env': 'PGOPTIONS=-c work_mem=8MB;TZ=UTC', 'password-fingerprint': PASSWORD_FINGERPRINT,
  mounts: 'dbvol:/opt/data:ro /var/lib/dokku/data/storage/myapp-db-extra:/opt/extra',
}
const REDIS_PROPERTIES = {
  memory: '128', 'log-driver': 'json-file', 'log-opt': 'max-file=3,max-size=10m', 'wait-timeout': '90',
  'config-options': '--maxmemory-policy allkeys-lru', mounts: '',
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
      'version': 'dokku version 0.38.32',
      'plugin:list --format json': JSON.stringify([
        { name: 'postgres', version: '2.4.0', committish: '2.4.0', enabled: true, core: false },
        { name: 'redis', version: '2.4.0', committish: '2.4.0', enabled: true, core: false },
      ]),
      'postgres:info myapp-db --format json': serviceInfoJson('myapp-db', 'postgis/postgis', '17-3.5', DB_PROPERTIES),
      'postgres:links myapp-db': 'myapp',
      'redis:info myapp-redis --format json': serviceInfoJson('myapp-redis', 'redis', '7.2-alpine', { ...REDIS_BACKUP, ...REDIS_PROPERTIES }),
      'postgres:info myapp-reports --format json': serviceInfoJson('myapp-reports', 'postgres', '17', REPORTS_BACKUP),
      'redis:backup-schedule-cat myapp-redis': '0 * * * * dokku /usr/bin/dokku redis:backup myapp-redis backups/myapp-redis',
      // Storage entries, as `storage:list-entries --format json` prints them (an entry made by hand and one by Dokku's legacy migration are not in the file).
      'storage:list-entries --format json': JSON.stringify([
        { name: 'data', scheduler: 'docker-local', host_path: '/var/lib/dokku/data/storage/data', chown: '1000', mode: '0750', schema_version: 1 },
        { name: 'media', scheduler: 'docker-local', host_path: '/srv/media', schema_version: 1 },
        { name: 'uploads', scheduler: 'docker-local', host_path: '/var/lib/dokku/data/storage/uploads', chown: 'herokuish', schema_version: 1 },
      ]),
      // Global settings
      'domains:report --global --domains-global-vhosts': 'example.com',
      'logs:report --global --format json': logsGlobalJson({
        'global-max-size': '50m', 'logs-global-max-size': '50m', 'computed-max-size': '50m', 'logs-computed-max-size': '50m',
        'global-vector-sink': SINK, 'logs-global-vector-sink': SINK, 'computed-vector-sink': SINK, 'logs-computed-vector-sink': SINK,
      }),
      'nginx:report --global --format json': nginxGlobalJson({ 'global-client-max-body-size': '20m' }),
      'scheduler:report --global --format json': globalReportJson('scheduler', { selected: 'docker-local' }),
      'registry:report --global --format json': globalReportJson('registry', {
        'auth-servers': 'registry.example.com', server: 'registry.example.com', 'push-on-release': 'true',
      }),
      'checks:report --global --format json': globalReportJson('checks', { 'wait-to-retire': '30' }),
      'ps:report --global --format json': globalReportJson('ps', { 'restart-policy': 'on-failure:5', 'stop-timeout-seconds': '45' }),
      'builder:report --global --format json': globalReportJson('builder', { selected: 'dockerfile', 'skip-cleanup': 'true' }),
      'builder-dockerfile:report --global --format json': globalReportJson('builder-dockerfile', { 'dockerfile-path': 'Dockerfile' }),
      'app-json:report --global --format json': globalReportJson('app-json', { 'appjson-path': 'app.json' }),
      'network:report --global --format json': globalReportJson('network', { 'attach-post-deploy': 'backend-net', tld: 'internal' }),
      'proxy:report --global --format json': globalReportJson('proxy', { type: 'nginx', 'proxy-port': '80' }),
      'git:report --global --format json': globalReportJson('git', { 'deploy-branch': 'main', 'keep-git-dir': 'true', 'archive-max-files': '20000' }),
      // Global env as config:export --global prints it: a hand-set key beside the managed ones.
      'config:export --global --format json': JSON.stringify({
        TZ: 'UTC', FEATURE_X: 'true', DOKKU_COMPOSE_GLOBAL_MANAGED_KEYS: 'TZ,FEATURE_X', HAND_SET: 'x',
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
      [`proxy:report ${app}`]: proxyReport(app),
      [`ports:report ${app} --ports-map`]: 'http:80:5000 https:443:5000',
      [`certs:report ${app} --ssl-enabled`]: 'true',
      [`certs:show ${app} crt`]: CRT,
      [`storage:report ${app} --format json`]: storageReportJson([
        { entry: 'uploads', hostPath: '/var/lib/dokku/data/storage/uploads', containerPath: '/app/uploads' },
        { entry: 'data', hostPath: '/var/lib/dokku/data/storage/data', containerPath: '/app/data', phases: 'deploy', readonly: true },
        { entry: 'media', hostPath: '/srv/media', containerPath: '/app/media', processType: 'worker', volumeOptions: 'Z' },
      ]),
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
        'restart-policy': 'on-failure:10', 'stop-timeout-seconds': '60', 'procfile-path': '', deployed: 'true', restore: 'false',
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
      // No own git settings: the app inherits the global ones (`git:set --global`).
      [`git:report ${app}`]: gitReport(app, INHERITED_GIT),

      // myapp-worker: no cert, all checks disabled, its own deploy branch
      [`certs:report ${worker} --ssl-enabled`]: 'false',
      [`checks:report ${worker}`]: report(worker, 'checks', {
        'Checks disabled list': '_all_',
        'Checks skipped list': 'none',
      }),
      [`domains:report ${worker} --domains-app-enabled`]: 'false',
            [`git:report ${worker}`]: gitReport(worker, { 'Git deploy branch': 'release' }),
      [`config:get ${worker} DOKKU_COMPOSE_MANAGED_KEYS`]: '',
      [`config:export --format json ${worker}`]: JSON.stringify({ GIT_REV: 'abc' }),
      ...nothingSet(worker),

      // myapp-edge: `ssl: true` (any cert) and an installed one
      [`certs:report ${edge} --ssl-enabled`]: 'true',
      [`certs:show ${edge} crt`]: CRT,
      [`config:get ${edge} DOKKU_COMPOSE_MANAGED_KEYS`]: '',
      [`git:report ${edge}`]: gitReport(edge, INHERITED_GIT),
      [`config:export --format json ${edge}`]: JSON.stringify({ SET_BY_SCRIPT: 'listed-value' }),
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

  it('diff shows a missing entry, a changed owner and mode, and one it cannot converge, and only notes an undeclared entry', async () => {
    const server = inSyncServer()
    server.queries['storage:list-entries --format json'] = JSON.stringify([
      { name: 'data', scheduler: 'docker-local', host_path: '/var/lib/dokku/data/storage/data', chown: 'root', mode: '0700' },
      { name: 'media', scheduler: 'docker-local', host_path: '/srv/old' },
      // not in the file: noted, except Dokku's own legacy entries and other schedulers', which are not
      { name: 'old', scheduler: 'docker-local', host_path: '/var/lib/dokku/data/storage/old' },
      { name: 'legacy-3f9c1a2b7d', scheduler: 'docker-local', host_path: '/srv/x' },
      { name: 'cluster', scheduler: 'k3s' },
    ])
    const diff = await computeDiff(fakeContext(server).ctx, loadConfig(FIXTURE))
    expect(diff.volumes['uploads']).toEqual({ status: 'missing' })
    expect(diff.volumes['data']).toMatchObject({ status: 'changed', current: { chown: 'root', mode: '0700' }, desired: { chown: '1000', mode: '0750' } })
    expect(diff.volumes['media']).toMatchObject({ status: 'changed', note: expect.stringContaining('Dokku cannot change an entry') })
    expect(diff.volumeNotes).toEqual(['old'])
    expect(diff.inSync).toBe(false)
    const summary = formatSummary(diff)
    expect(summary).toContain('uploads: not created')
    expect(summary).toContain('chown root → 1000, mode 0700 → 0750')
    expect(summary).toContain('storage entries not in the compose file (up leaves them): old')
    expect(formatVerbose(diff)).toContain('@@ volumes / data @@')
  })

  it('an undeclared entry alone is a note and not drift', async () => {
    const server = inSyncServer()
    const entries = JSON.parse(server.queries['storage:list-entries --format json']) as object[]
    server.queries['storage:list-entries --format json'] = JSON.stringify([...entries, { name: 'old', scheduler: 'docker-local', host_path: '/srv/old' }])
    const diff = await computeDiff(fakeContext(server).ctx, loadConfig(FIXTURE))
    expect(diff.volumeNotes).toEqual(['old'])
    expect(diff.inSync).toBe(true)
  })

  it('diff shows a legacy mount against the named entry that replaces it', async () => {
    const server = inSyncServer()
    server.queries['storage:report myapp --format json'] = storageReportJson([
      { entry: 'legacy-3f9c1a2b7d', hostPath: '/var/lib/dokku/data/storage/uploads', containerPath: '/app/uploads', phases: 'deploy' },
      { entry: 'data', hostPath: '/var/lib/dokku/data/storage/data', containerPath: '/app/data', phases: 'deploy', readonly: true },
      { entry: 'media', hostPath: '/srv/media', containerPath: '/app/media', processType: 'worker', volumeOptions: 'Z' },
    ])
    const diff = await computeDiff(fakeContext(server).ctx, loadConfig(FIXTURE))
    expect(diff.apps['myapp'].storage.status).toBe('changed')
    const verbose = formatVerbose(diff)
    expect(verbose).toContain('"legacy-3f9c1a2b7d:/app/uploads:phase=deploy"')
    expect(verbose).toContain('"uploads:/app/uploads"')
  })

  it('up creates a missing entry and moves a legacy mount onto it, before the app step', async () => {
    const server = inSyncServer()
    const entries = JSON.parse(server.queries['storage:list-entries --format json']) as { name: string }[]
    server.queries['storage:list-entries --format json'] = JSON.stringify([
      ...entries.filter(e => e.name !== 'uploads'),
      { name: 'legacy-3f9c1a2b7d', scheduler: 'docker-local', host_path: '/var/lib/dokku/data/storage/uploads' },
    ])
    server.queries['storage:report myapp --format json'] = storageReportJson([
      { entry: 'legacy-3f9c1a2b7d', hostPath: '/var/lib/dokku/data/storage/uploads', containerPath: '/app/uploads' },
      { entry: 'data', hostPath: '/var/lib/dokku/data/storage/data', containerPath: '/app/data', phases: 'deploy', readonly: true },
      { entry: 'media', hostPath: '/srv/media', containerPath: '/app/media', processType: 'worker', volumeOptions: 'Z' },
    ])
    const { ctx, runner } = fakeContext(server)
    await runUp(ctx, loadConfig(FIXTURE), [])
    expect(runner.dryRunLog).toEqual([
      'storage:create uploads --chown herokuish',
      'storage:mount --replace myapp uploads:/app/uploads data:/app/data:ro,phase=deploy',
    ])
  })

  it('an entry that cannot be converged is reported, and the app that mounts it skips its storage step', async () => {
    const server = inSyncServer()
    const entries = JSON.parse(server.queries['storage:list-entries --format json']) as { name: string; host_path: string }[]
    server.queries['storage:list-entries --format json'] = JSON.stringify(entries.map(e => e.name === 'media' ? { ...e, host_path: '/srv/old' } : e))
    server.queries['storage:report myapp --format json'] = storageReportJson([])
    const { ctx, runner } = fakeContext(server)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(runUp(ctx, loadConfig(FIXTURE), [])).rejects.toThrow(/up failed for 1 app\(s\): myapp/)
    expect(runner.dryRunLog.filter(c => c.startsWith('storage:'))).toEqual([])
    const shown = err.mock.calls.map(c => String(c[0])).join('\n')
    expect(shown).toContain("entry 'media' is at /srv/old on the server but the file says /srv/media")
    expect(shown).toContain("storage skipped: entry 'media' failed")
    err.mockRestore()
  })

  it('up --prune never destroys an entry the file does not declare', async () => {
    const server = inSyncServer()
    const entries = JSON.parse(server.queries['storage:list-entries --format json']) as object[]
    server.queries['storage:list-entries --format json'] = JSON.stringify([...entries, { name: 'old', scheduler: 'docker-local', host_path: '/var/lib/dokku/data/storage/old', chown: 'root' }])
    const { ctx, runner } = fakeContext(server)
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

  it('a network property declared false but set on the server shows in diff, and up clears exactly it', async () => {
    const server = inSyncServer()
    server.queries['network:report myapp'] = report('myapp', 'network', {
      'Network attach post create': 'backend-net',
      'Network attach post deploy': 'backend-net',
      'Network bind all interfaces': 'true',
      'Network initial network': 'bridge',
      'Network static web listener': '127.0.0.1:5000',
      'Network tld': 'internal',
    })
    const diff = await computeDiff(fakeContext(server).ctx, loadConfig(FIXTURE))
    expect(diff.apps['myapp'].network).toMatchObject({ status: 'changed' })
    expect(diff.inSync).toBe(false)
    const { ctx, runner } = fakeContext(server)
    await runUp(ctx, loadConfig(FIXTURE), [])
    expect(runner.dryRunLog).toEqual(['network:set myapp static-web-listener'])
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
    server.queries['postgres:info myapp-db --format json'] = serviceInfoJson('myapp-db', 'postgres', '16.1', DB_PROPERTIES)
    server.queries['redis:info myapp-redis --format json'] = serviceInfoJson('myapp-redis', 'redis', '7.0-alpine', { ...REDIS_BACKUP, ...REDIS_PROPERTIES })
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
      TZ: 'Qx7vK/Zw3', FEATURE_X: 'true', DOKKU_COMPOSE_GLOBAL_MANAGED_KEYS: 'TZ,FEATURE_X',
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

  it('an undeclared app key the file lists in env_external is not noted; one it does not list is noted by name, still in sync', async () => {
    const server = inSyncServer()
    server.queries['config:export --format json myapp-edge'] = JSON.stringify({
      SET_BY_SCRIPT: 'listed-value', HAND_SET: 'hand-value', TZ: 'UTC', GIT_REV: 'abc', DOKKU_APP_TYPE: 'dockerfile',
    })
    const diff = await computeDiff(fakeContext(server).ctx, loadConfig(FIXTURE))
    expect(diff.envNotes).toEqual({ 'myapp-edge': [{ key: 'HAND_SET' }, { key: 'TZ', label: 'duplicate of global' }] })
    expect(diff.inSync).toBe(true)
    for (const shown of [formatSummary(diff), formatVerbose(diff), JSON.stringify(maskDiffResult(diff))]) {
      expect(shown).toContain('HAND_SET')
      expect(shown).not.toContain('SET_BY_SCRIPT')
      expect(shown).not.toContain('hand-value')
    }
    expect(formatSummary(diff)).toContain('Everything in sync.')
    expect(formatSummary(diff)).toContain('TZ (duplicate of global)')
    const { ctx, runner } = fakeContext(server)
    await runUp(ctx, loadConfig(FIXTURE), [], { prune: true })
    expect(runner.dryRunLog).toEqual([])
  })

  // Gaps owned by other issues. Each becomes a real assertion when its issue lands.
  it('postgres backup is read from postgres:info: in sync runs no write, a changed bucket and an old hash key show in diff and up fixes exactly those', async () => {
    const backup = {
      schedule: '0 * * * *', bucket: 'backups/myapp-db',
      auth: { access_key_id: 'KEY', secret_access_key: 'SECRET', region: 'auto', signature_version: 's3v4', endpoint: 'https://s3.example.com' },
    }
    const config = loadConfig(FIXTURE)
    config.postgres!['myapp-db'].backup = backup
    const onServer = {
      'backup-schedule': '0 * * * *', 'backup-bucket': 'backups/myapp-db', 'backup-authenticated': 'true',
      // printf 'KEY\nSECRET' | shasum -a 256
      'backup-auth-fingerprint': '367b0dd6299da53d84c87a01b0519aed571f65b54ed7d95687fbbaf6760462b3',
      'backup-default-region': 'auto', 'backup-signature-version': 's3v4', 'backup-endpoint-url': 'https://s3.example.com',
    }
    const server = inSyncServer()
    server.queries['postgres:info myapp-db --format json'] = serviceInfoJson('myapp-db', 'postgis/postgis', '17-3.5', { ...DB_PROPERTIES, ...onServer })
    const same = fakeContext(server)
    expect((await computeDiff(same.ctx, config)).inSync).toBe(true)
    const quiet = fakeContext(server)
    await runUp(quiet.ctx, config, [])
    expect(quiet.runner.dryRunLog).toEqual([])
    expect((quiet.runner.queryStrict as any).mock.calls.filter((c: string[]) => c[0] === 'postgres:info' && c[1] === 'myapp-db')).toHaveLength(1)

    server.queries['postgres:info myapp-db --format json'] = serviceInfoJson('myapp-db', 'postgis/postgis', '17-3.5', { ...DB_PROPERTIES, ...onServer, 'backup-bucket': 'old/myapp-db' })
    server.queries['config:export --global --format json'] = JSON.stringify({
      ...JSON.parse(server.queries['config:export --global --format json']), DOKKU_COMPOSE_BACKUP_HASH_MYAPP_DB: 'abc123',
    })
    const diff = await computeDiff(fakeContext(server).ctx, config)
    expect(diff.services['myapp-db']).toMatchObject({ status: 'changed', mismatches: [{ field: 'backup.bucket', current: 'old/myapp-db', desired: 'backups/myapp-db' }] })
    expect(diff.global.backup_hash).toMatchObject({ removed: ['DOKKU_COMPOSE_BACKUP_HASH_MYAPP_DB'] })
    expect(formatVerbose(diff)).not.toContain('SECRET')
    const fix = fakeContext(server)
    await runUp(fix.ctx, config, [])
    expect(fix.runner.dryRunLog).toEqual([
      'postgres:set myapp-db backup-bucket backups/myapp-db',
      'config:unset --global --no-restart DOKKU_COMPOSE_BACKUP_HASH_MYAPP_DB',
    ])
  })

  it('a dokku-postgres too old to report backup state is unknown in diff', async () => {
    const config = loadConfig(FIXTURE)
    config.postgres!['myapp-db'].backup = {
      schedule: '0 * * * *', bucket: 'backups/myapp-db',
      auth: { access_key_id: 'KEY', secret_access_key: 'SECRET', region: 'auto', signature_version: 's3v4', endpoint: 'https://s3.example.com' },
    }
    const server = inSyncServer()
    server.queries['postgres:info myapp-db --format json'] = JSON.stringify({ image: 'postgis/postgis', 'image-version': '17-3.5' })
    const diff = await computeDiff(fakeContext(server).ctx, config)
    expect(diff.services['myapp-db']).toMatchObject({ status: 'unknown' })
    expect(diff.readWarnings.join('\n')).toContain('needs 2.3.1+')
  })

  it('a backup on the server that the file omits is a diff note; up --prune only warns', async () => {
    const server = inSyncServer()
    server.queries['postgres:info myapp-db --format json'] = serviceInfoJson('myapp-db', 'postgis/postgis', '17-3.5', { ...DB_PROPERTIES,
      'backup-schedule': '0 3 * * *', 'backup-bucket': 'backups/myapp-db', 'backup-authenticated': 'true',
    })
    const diff = await computeDiff(fakeContext(server).ctx, loadConfig(FIXTURE))
    expect(diff.inSync).toBe(true)
    expect(formatSummary(diff)).toContain('note: backup on the server is not in the file (scheduled 0 3 * * * to backups/myapp-db, credentials stored)')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { ctx, runner } = fakeContext(server)
      await runUp(ctx, loadConfig(FIXTURE), [], { prune: true })
      expect(runner.dryRunLog).toEqual([])
      expect(warn.mock.calls.map(c => String(c[0])).some(l => l.includes('set backup: false to remove it'))).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })

  it('redis encryption and settings drift shows in diff without the passphrase, and up fixes exactly those', async () => {
    const server = inSyncServer()
    server.queries['redis:info myapp-redis --format json'] = serviceInfoJson('myapp-redis', 'redis', '7.2-alpine', { ...REDIS_PROPERTIES,
      ...REDIS_BACKUP, 'backup-encryption-fingerprint': createHash('sha256').update('old-passphrase').digest('hex'),
      'backup-mailto': 'other@example.com', 'backup-timestamp': 'true',
    })
    const diff = await computeDiff(fakeContext(server).ctx, loadConfig(FIXTURE))
    expect(diff.inSync).toBe(false)
    expect(diff.services['myapp-redis'].mismatches!.map(m => m.field)).toEqual(['backup.encryption', 'backup.mailto', 'backup.timestamp'])
    expect(formatVerbose(diff) + formatSummary(diff)).not.toContain('in-sync-passphrase')
    expect(formatVerbose(diff) + formatSummary(diff)).not.toContain('old-passphrase')
    const fix = fakeContext(server)
    await runUp(fix.ctx, loadConfig(FIXTURE), [])
    expect(fix.runner.dryRunLog).toEqual([
      'redis:set myapp-redis backup-encryption-passphrase in-sync-passphrase',
      'redis:set myapp-redis backup-mailto ops@example.com',
      'redis:set myapp-redis backup-timestamp false',
    ])
  })

  it('encryption the file leaves out is a diff note, never drift; settings it leaves out are cleared only by --prune', async () => {
    const config = loadConfig(FIXTURE)
    delete (config.redis!['myapp-redis'].backup as any).encryption
    delete (config.redis!['myapp-redis'].backup as any).mailto
    const server = inSyncServer()
    const diff = await computeDiff(fakeContext(server).ctx, config)
    expect(diff.inSync).toBe(true)
    expect(diff.services['myapp-redis'].note).toContain('backup encryption on the server is not in the file')
    expect(diff.services['myapp-redis'].note).toContain('backup mailto on the server is not in the file')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const plain = fakeContext(server)
      await runUp(plain.ctx, config, [])
      expect(plain.runner.dryRunLog).toEqual([])
      const pruned = fakeContext(server)
      await runUp(pruned.ctx, config, [], { prune: true })
      expect(pruned.runner.dryRunLog).toEqual(['redis:set myapp-redis backup-mailto'])
    } finally {
      warn.mockRestore()
    }
  })

  it('other schedules on a 2.5.0 plugin are a diff note and never touched by up', async () => {
    const server = inSyncServer()
    server.queries['redis:info myapp-redis --format json'] = serviceInfoJson('myapp-redis', 'redis', '7.2-alpine', { ...REDIS_PROPERTIES,
      ...REDIS_BACKUP, 'backup-schedules': 'default|0 * * * *|backups/myapp-redis|false;monthly|@monthly|archive|false',
    })
    const diff = await computeDiff(fakeContext(server).ctx, loadConfig(FIXTURE))
    expect(diff.inSync).toBe(true)
    expect(diff.services['myapp-redis'].note).toContain('other backup schedules (monthly)')
    const { ctx, runner } = fakeContext(server)
    await runUp(ctx, loadConfig(FIXTURE), [], { prune: true })
    expect(runner.dryRunLog).toEqual([])
  })
})

// The top-level blocks are Dokku's own `--global` settings. Each test changes one value on the
// in-sync server and checks that `up` sets exactly that, and that `--prune` clears a dropped key.
describe('top-level global blocks', () => {
  let log: ReturnType<typeof vi.spyOn>
  let warn: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => {})
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => { log.mockRestore(); warn.mockRestore() })

  async function up(server: FakeServer, opts: { prune?: boolean } = {}, apps: string[] = []) {
    const { ctx, runner } = fakeContext(server)
    await runUp(ctx, loadConfig(FIXTURE), apps, opts)
    return { ctx, log: runner.dryRunLog }
  }

  it('nginx and logs: a key the declared block dropped is cleared by --prune and left otherwise', async () => {
    const server = inSyncServer()
    server.queries['nginx:report --global --format json'] = nginxGlobalJson({ 'global-client-max-body-size': '20m', 'global-hsts': 'true' })
    expect((await up(server)).log).toEqual([])
    expect((await up(server, { prune: true })).log).toEqual(['nginx:set --global hsts'])
    expect(warn.mock.calls.map(c => String(c[0])).some(l => l.includes('1 global nginx setting(s) no longer in the compose file'))).toBe(true)

    const logs = inSyncServer()
    logs.queries['logs:report --global --format json'] = logsGlobalJson({
      'global-max-size': '50m', 'global-vector-sink': SINK, 'global-vector-image': 'timberio/vector:0.36.0-alpine',
    })
    expect((await up(logs, { prune: true })).log).toEqual(['logs:set --global vector-image'])
  })

  it('scheduler: a different global selected is set; a dropped shell is pruned', async () => {
    const server = inSyncServer()
    server.queries['scheduler:report --global --format json'] = globalReportJson('scheduler', { selected: 'null', shell: 'bash' })
    expect((await up(server)).log).toEqual(['scheduler:set --global selected docker-local'])
    expect((await up(server, { prune: true })).log).toEqual([
      'scheduler:set --global selected docker-local',
      'scheduler:set --global shell',
    ])
  })

  it('registry: a changed push-on-release is set; a dropped template is pruned; auth-servers is never touched', async () => {
    const server = inSyncServer()
    server.queries['registry:report --global --format json'] = globalReportJson('registry', {
      'auth-servers': 'registry.example.com', server: 'registry.example.com', 'push-on-release': 'false',
      'image-repo-template': 'example/{{ .AppName }}',
    })
    expect((await up(server)).log).toEqual(['registry:set --global push-on-release true'])
    expect((await up(server, { prune: true })).log).toEqual([
      'registry:set --global push-on-release true',
      'registry:set --global image-repo-template',
    ])
  })

  it('checks: a changed global wait-to-retire is set and lists no restart; an empty declared block prunes it', async () => {
    const server = inSyncServer()
    server.queries['checks:report --global --format json'] = globalReportJson('checks', { 'wait-to-retire': '20' })
    const changed = await up(server)
    expect(changed.log).toEqual(['checks:set --global wait-to-retire 30'])
    expect(changed.ctx.restarts.size + changed.ctx.rebuilds.size).toBe(0)

    const config = loadConfig(FIXTURE)
    config.checks = {}
    const { ctx, runner } = fakeContext(server)
    await runUp(ctx, config, [], { prune: true })
    expect(runner.dryRunLog).toEqual(['checks:set --global wait-to-retire'])
  })

  it('ps: a changed restart policy is set without a restart listing; a dropped skip-deploy is pruned', async () => {
    const server = inSyncServer()
    server.queries['ps:report --global --format json'] = globalReportJson('ps', {
      'restart-policy': 'always', 'stop-timeout-seconds': '45', 'skip-deploy': 'true',
    })
    const changed = await up(server)
    expect(changed.log).toEqual(['ps:set --global restart-policy on-failure:5'])
    expect(changed.ctx.restarts.size + changed.ctx.rebuilds.size).toBe(0)
    expect((await up(server, { prune: true })).log).toEqual([
      'ps:set --global restart-policy on-failure:5',
      'ps:set --global skip-deploy',
    ])
  })

  it('build: a changed global key sets it with its own command and lists the apps that do not set it for rebuild', async () => {
    const server = inSyncServer()
    server.queries['builder:report --global --format json'] = globalReportJson('builder', { selected: 'pack', 'skip-cleanup': 'true' })
    server.queries['builder-dockerfile:report --global --format json'] = globalReportJson('builder-dockerfile', { 'dockerfile-path': 'old/Dockerfile' })
    const changed = await up(server, {}, ['myapp', 'myapp-worker'])
    expect(changed.log).toEqual([
      'builder-dockerfile:set --global dockerfile-path Dockerfile',
      'builder:set --global selected dockerfile',
    ])
    // myapp sets build.dockerfile itself, so only `selected` reaches it; both reach the worker.
    expect([...changed.ctx.rebuilds.keys()].sort()).toEqual(['myapp', 'myapp-worker'])
    const skip = inSyncServer()
    skip.queries['builder:report --global --format json'] = globalReportJson('builder', { selected: 'dockerfile' })
    const cleanup = await up(skip, {}, ['myapp'])
    expect(cleanup.log).toEqual(['builder:set --global skip-cleanup true'])
    expect(cleanup.ctx.rebuilds.size).toBe(0)
  })

  it('build: --prune clears a dropped key with its own command', async () => {
    const server = inSyncServer()
    server.queries['builder:report --global --format json'] = globalReportJson('builder', { selected: 'dockerfile', 'skip-cleanup': 'true', 'build-dir': 'apps/api' })
    server.queries['app-json:report --global --format json'] = globalReportJson('app-json', { 'appjson-path': 'app.json' })
    expect((await up(server)).log).toEqual([])
    expect((await up(server, { prune: true })).log).toEqual(['builder:set --global build-dir'])
  })

  it('network: a changed attach_post_deploy lists for rebuild only the apps without their own networks:', async () => {
    const server = inSyncServer()
    server.queries['network:report --global --format json'] = globalReportJson('network', { tld: 'internal' })
    const changed = await up(server)
    expect(changed.log).toEqual(['network:set --global attach-post-deploy backend-net'])
    expect([...changed.ctx.rebuilds.keys()].sort()).toEqual(['myapp-edge', 'myapp-worker'])
    expect(changed.ctx.restarts.size).toBe(0)
  })

  it('network: a changed tld lists for restart only the apps without their own tld', async () => {
    const server = inSyncServer()
    server.queries['network:report --global --format json'] = globalReportJson('network', { 'attach-post-deploy': 'backend-net', tld: 'cluster.local' })
    const changed = await up(server)
    expect(changed.log).toEqual(['network:set --global tld internal'])
    expect([...changed.ctx.restarts.keys()].sort()).toEqual(['myapp-edge', 'myapp-worker'])
    // A run limited to one app lists only it; apps outside the run are never listed.
    const limited = await up(server, {}, ['myapp-worker'])
    expect([...limited.ctx.restarts.keys()]).toEqual(['myapp-worker'])
  })

  it('network: bind_all_interfaces false is in sync when unset and set to false when the server says true', async () => {
    const server = inSyncServer()
    expect((await up(server)).log).toEqual([])
    server.queries['network:report --global --format json'] = globalReportJson('network', { 'attach-post-deploy': 'backend-net', tld: 'internal', 'bind-all-interfaces': 'true' })
    expect((await up(server)).log).toEqual(['network:set --global bind-all-interfaces false'])
  })

  it('network: --prune clears a dropped key and lists the apps, but never attach_post_deploy', async () => {
    const server = inSyncServer()
    server.queries['network:report --global --format json'] = globalReportJson('network', {
      'attach-post-deploy': 'backend-net', tld: 'internal', 'initial-network': 'bridge',
    })
    expect((await up(server)).log).toEqual([])
    const pruned = await up(server, { prune: true })
    expect(pruned.log).toEqual(['network:set --global initial-network'])
    // myapp sets initial_network itself, so the cleared global value does not reach it.
    expect([...pruned.ctx.rebuilds.keys()].sort()).toEqual(['myapp-edge', 'myapp-worker'])

    const config = loadConfig(FIXTURE)
    config.network = { tld: 'internal' }
    const { ctx, runner } = fakeContext(server)
    await runUp(ctx, config, [], { prune: true })
    expect(runner.dryRunLog).toEqual(['network:set --global initial-network'])
  })

  it('a block the file does not declare is never read or touched, even under --prune', async () => {
    const config = loadConfig(FIXTURE)
    for (const name of ['scheduler', 'registry', 'checks', 'ps', 'build', 'network', 'proxy', 'git', 'nginx', 'logs'] as const) delete (config as any)[name]
    const server = inSyncServer()
    // Settings made outside the file.
    server.queries['scheduler:report --global --format json'] = globalReportJson('scheduler', { selected: 'null' })
    server.queries['git:report --global --format json'] = globalReportJson('git', { 'deploy-branch': 'master' })
    const { ctx, runner } = fakeContext(server)
    await runUp(ctx, config, [], { prune: true })
    const reads = (runner.queryStrict as any).mock.calls.map((c: string[]) => c.join(' '))
    expect(reads.filter((r: string) => r.includes('--global') && /^(scheduler|registry|checks|ps|builder|network|proxy|git|nginx|logs):/.test(r))).toEqual([])
    expect(runner.dryRunLog.filter(c => c.includes('--global'))).toEqual([])
  })

  it('a failing global step aborts the run before any app is processed', async () => {
    const server = inSyncServer()
    server.queries['scheduler:report --global --format json'] = globalReportJson('scheduler', { selected: 'null' })
    const { ctx, runner } = fakeContext(server)
    runner.run = vi.fn(async (...args: string[]) => {
      if (args[0] === 'scheduler:set') throw new Error('dokku scheduler:set failed')
    })
    await expect(runUp(ctx, loadConfig(FIXTURE), [])).rejects.toThrow('scheduler:set failed')
    expect((runner.run as any).mock.calls.filter((c: string[]) => c[0] === 'apps:create')).toEqual([])
    expect(ctx.commands.some(c => c[0] === 'ports:set' || c[0] === 'git:set')).toBe(false)
  })

  it('an unreadable global report aborts the run too', async () => {
    const server = inSyncServer()
    server.queries['ps:report --global --format json'] = 'not json'
    await expect(runUp(fakeContext(server).ctx, loadConfig(FIXTURE), [])).rejects.toThrow(/json/)
  })

  describe('diff shows the global blocks under global', () => {
    const diffOf = (server: FakeServer, mutate: (c: ReturnType<typeof loadConfig>) => void = () => {}) => {
      const config = loadConfig(FIXTURE)
      mutate(config)
      return computeDiff(fakeContext(server).ctx, config)
    }

    it('a changed value is ~, a value the server lacks is +, and both count as drift', async () => {
      const server = inSyncServer()
      server.queries['registry:report --global --format json'] = globalReportJson('registry', { server: 'old.example.com', 'push-on-release': 'true' })
      server.queries['scheduler:report --global --format json'] = globalReportJson('scheduler', {})
      server.queries['checks:report --global --format json'] = globalReportJson('checks', {})
      const diff = await diffOf(server)
      expect(diff.global.registry).toMatchObject({ status: 'changed', desired: { server: 'registry.example.com', 'push-on-release': true }, current: { server: 'old.example.com', 'push-on-release': 'true' } })
      expect(diff.global.scheduler).toMatchObject({ status: 'missing', desired: 'docker-local' })
      expect(diff.global.checks).toMatchObject({ status: 'missing' })
      expect(diff.inSync).toBe(false)
      const summary = formatSummary(diff)
      expect(summary.match(/^  global$/gm)).toHaveLength(1)
      expect(summary).toMatch(/~ registry/)
      expect(summary).toMatch(/\+ scheduler/)
      expect(formatVerbose(diff)).toContain('@@ global / registry @@')
    })

    it('a key the declared block dropped is - and counts as drift', async () => {
      const server = inSyncServer()
      server.queries['ps:report --global --format json'] = globalReportJson('ps', { 'restart-policy': 'on-failure:5', 'stop-timeout-seconds': '45', 'skip-deploy': 'true' })
      server.queries['network:report --global --format json'] = globalReportJson('network', { 'attach-post-deploy': 'backend-net', tld: 'internal', 'initial-network': 'bridge' })
      const diff = await diffOf(server)
      expect(diff.global.ps).toMatchObject({ status: 'extra', removed: ['skip-deploy'] })
      expect(diff.global.network).toMatchObject({ status: 'extra', removed: ['initial_network'] })
      expect(diff.inSync).toBe(false)
      expect(formatSummary(diff)).toContain('not in the file: skip-deploy')
      expect(formatVerbose(diff)).toContain('- skip-deploy (not in the file)')
    })

    it('a block the file does not declare is never read or shown', async () => {
      const server = inSyncServer()
      server.queries['ps:report --global --format json'] = globalReportJson('ps', { 'restart-policy': 'always' })
      const diff = await diffOf(server, c => { delete (c as any).ps })
      expect(diff.global.ps).toBeUndefined()
      expect(diff.inSync).toBe(true)
    })

    it('an attach_post_deploy the block does not declare is not a removal', async () => {
      const server = inSyncServer()
      const diff = await diffOf(server, c => { c.network = { tld: 'internal', bind_all_interfaces: false } })
      expect(diff.global.network).toBeUndefined()
      expect(diff.inSync).toBe(true)
    })

    it('an unreadable global report is unknown, not missing', async () => {
      const server = inSyncServer()
      server.queries['git:report --global --format json'] = 'not json'
      const diff = await diffOf(server)
      expect(diff.global.git).toMatchObject({ status: 'unknown' })
      expect(diff.readWarnings.join('\n')).toContain("could not read global 'git'")
      expect(diff.inSync).toBe(false)
    })

    it('a log sink under global is masked in the output', async () => {
      const server = inSyncServer()
      server.queries['logs:report --global --format json'] = logsGlobalJson({ 'global-max-size': '50m', 'global-vector-sink': 'http://user:secret@logs.example.com' })
      const diff = await diffOf(server)
      expect(diff.global.logs).toMatchObject({ status: 'changed' })
      expect(JSON.stringify(maskDiffResult(diff))).not.toContain('secret')
    })
  })

  it('proxy: a changed type or port is set and lists no restart; a dropped key is pruned; enabled stays per app', async () => {
    const server = inSyncServer()
    server.queries['proxy:report --global --format json'] = globalReportJson('proxy', { type: 'caddy', 'proxy-port': '80', 'proxy-ssl-port': '443' })
    const changed = await up(server)
    expect(changed.log).toEqual(['proxy:set --global type nginx'])
    expect(changed.ctx.restarts.size + changed.ctx.rebuilds.size).toBe(0)
    expect((await up(server, { prune: true })).log).toEqual(['proxy:set --global type nginx', 'proxy:set --global proxy-ssl-port'])
    const diff = await computeDiff(fakeContext(server).ctx, loadConfig(FIXTURE))
    expect(diff.global.proxy).toMatchObject({ status: 'changed', removed: ['proxy_ssl_port'] })
  })

  it('git: a changed global value is set, including the limits that exist only globally; a dropped key is pruned', async () => {
    const server = inSyncServer()
    server.queries['git:report --global --format json'] = globalReportJson('git', {
      'deploy-branch': 'master', 'keep-git-dir': 'true', 'archive-max-files': '5000', 'archive-max-size': '1073741824',
    })
    expect((await up(server)).log).toEqual([
      'git:set --global deploy-branch main',
      'git:set --global archive-max-files 20000',
    ])
    expect((await up(server, { prune: true })).log).toEqual([
      'git:set --global deploy-branch main',
      'git:set --global archive-max-files 20000',
      'git:set --global archive-max-size',
    ])
  })

  it('git migration: what the old top-level git: copied onto an app is a diff removal and --prune clears it', async () => {
    const server = inSyncServer()
    // The old behaviour wrote the top-level block onto every app that had no git: of its own.
    server.queries['git:report myapp'] = gitReport('myapp', { ...INHERITED_GIT, 'Git deploy branch': 'main', 'Git keep git dir': 'true' })
    // An app with a different deploy branch chose it: an override, not a copy.
    server.queries['git:report myapp-edge'] = gitReport('myapp-edge', { ...INHERITED_GIT, 'Git deploy branch': 'release', 'Git keep git dir': 'true' })

    const diff = await computeDiff(fakeContext(server).ctx, loadConfig(FIXTURE))
    expect(diff.apps.myapp.git).toMatchObject({ status: 'extra', removed: ['deploy_branch', 'keep_git_dir'] })
    expect(diff.apps['myapp-edge'].git).toMatchObject({ status: 'extra', removed: ['keep_git_dir'] })
    expect(diff.inSync).toBe(false)
    expect(formatSummary(diff)).toContain('not in the file: deploy_branch, keep_git_dir')

    expect((await up(server)).log).toEqual([])
    expect((await up(server, { prune: true })).log).toEqual([
      'git:set myapp deploy-branch',
      'git:set myapp keep-git-dir',
      'git:set myapp-edge keep-git-dir',
    ])
  })
})

describe('datastore properties and mounts', () => {
  let lines: string[]
  beforeEach(() => {
    lines = []
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { lines.push(a.join(' ')) })
  })
  afterEach(() => { vi.restoreAllMocks() })

  const leaks = (out: string, secret: string) => {
    const found: string[] = []
    for (let i = 0; i + 3 <= secret.length; i++) if (out.includes(secret.slice(i, i + 3))) found.push(secret.slice(i, i + 3))
    return found
  }

  it('a changed memory, a changed custom-env and a changed mount show in diff, and up sets exactly those and lists the service for stop and start', async () => {
    const server = inSyncServer()
    server.queries['postgres:info myapp-db --format json'] = serviceInfoJson('myapp-db', 'postgis/postgis', '17-3.5', {
      ...DB_PROPERTIES, memory: '256', 'custom-env': 'TZ=Qx7vK/Zw3', mounts: 'dbvol:/opt/data:ro',
    })
    const config = loadConfig(FIXTURE)
    const diff = await computeDiff(fakeContext(server).ctx, config)
    expect(diff.services['myapp-db'].mismatches!.map(m => m.field)).toEqual(['properties.memory', 'properties.custom-env', 'mounts'])
    const { ctx, runner } = fakeContext(server)
    await runUp(ctx, config, [], { dryRun: true })
    expect(runner.dryRunLog).toEqual([
      'postgres:set myapp-db memory -- 512',
      "postgres:set myapp-db custom-env -- 'TZ=UTC;PGOPTIONS=-c work_mem=8MB'",
      'postgres:mount --replace myapp-db /var/lib/dokku/data/storage/myapp-db-extra:/opt/extra dbvol:/opt/data:ro',
    ])
    expect(lines).toContain('dokku postgres:stop myapp-db && dokku postgres:start myapp-db  # memory, custom-env, mounts')
  })

  it('custom-env values never show in the masked diff or the masked dry-run listing, only with --sensitive', async () => {
    const server = inSyncServer()
    server.queries['postgres:info myapp-db --format json'] = serviceInfoJson('myapp-db', 'postgis/postgis', '17-3.5', {
      ...DB_PROPERTIES, 'custom-env': 'TZ=Qx7vK/Zw3;PGOPTIONS=zqxwv-9k3',
    })
    const config = loadConfig(FIXTURE)
    const diff = await computeDiff(fakeContext(server).ctx, config)
    const masked = formatVerbose(maskDiffResult(diff)) + formatSummary(maskDiffResult(diff)) + JSON.stringify(maskDiffResult(diff))
    for (const secret of ['Qx7vK/Zw3', 'zqxwv-9k3']) expect(leaks(masked, secret)).toEqual([])
    // the file's own value (PGOPTIONS=-c work_mem=8MB) is a desired value, masked as well
    expect(masked).not.toContain('work_mem')
    expect(masked).toContain('TZ=****')
    expect(formatVerbose(diff)).toContain('Qx7vK/Zw3')
    const { ctx, runner } = fakeContext(server)
    await runUp(ctx, config, [], { dryRun: true })
    expect(maskSensitiveArgs(runner.dryRunLog[0])).toBe('postgres:set myapp-db custom-env -- TZ=****;PGOPTIONS=****')
  })

  it('a changed password shows without either value, up sets it with --no-restart and lists the linked apps, and nothing prints it', async () => {
    const server = inSyncServer()
    server.queries['postgres:info myapp-db --format json'] = serviceInfoJson('myapp-db', 'postgis/postgis', '17-3.5', {
      ...DB_PROPERTIES, 'password-fingerprint': createHash('sha256').update('Jv8-Hh2.zq7k').digest('hex'),
    })
    const config = loadConfig(FIXTURE)
    const diff = await computeDiff(fakeContext(server).ctx, config)
    expect(diff.services['myapp-db'].mismatches).toEqual([{ field: 'properties.password', desired: 'the password from the file', current: 'another password' }])
    const { ctx, runner } = fakeContext(server)
    await runUp(ctx, config, [], { dryRun: true })
    expect(runner.dryRunLog).toEqual(['postgres:set --no-restart myapp-db password -- Zq7-Hk9vbn2'])
    expect(maskSensitiveArgs(runner.dryRunLog[0])).toBe('postgres:set --no-restart myapp-db password -- ****')
    expect(lines).toContain('dokku ps:restart myapp  # myapp-db password changed')
    const output = lines.join('\n') + formatVerbose(maskDiffResult(diff)) + formatSummary(maskDiffResult(diff))
    for (const secret of ['Zq7-Hk9vbn2', 'Jv8-Hh2.zq7k']) expect(leaks(output, secret)).toEqual([])
  })

  it('a key the file dropped is a - in diff and in the count; up leaves it, up --prune clears exactly it', async () => {
    const config = loadConfig(FIXTURE)
    delete config.postgres!['myapp-db'].properties!['restart-policy']
    const server = inSyncServer()
    const diff = await computeDiff(fakeContext(server).ctx, config)
    expect(diff.services['myapp-db'].mismatches).toEqual([{ field: 'properties.restart-policy', desired: '(not in the file)', current: 'unless-stopped', removed: true }])
    expect(diff.inSync).toBe(false)
    expect(formatSummary(diff)).toContain('- properties.restart-policy: unless-stopped (not in the file)')
    const plain = fakeContext(server)
    await runUp(plain.ctx, config, [], { dryRun: true })
    expect(plain.runner.dryRunLog).toEqual([])
    const pruned = fakeContext(server)
    await runUp(pruned.ctx, config, [], { dryRun: true, prune: true })
    expect(pruned.runner.dryRunLog).toEqual(['postgres:set myapp-db restart-policy'])
  })

  it('a service with no properties: block still shows a known key the server holds as a -', async () => {
    const config = loadConfig(FIXTURE)
    config.postgres!['myapp-reports'].properties = undefined
    const server = inSyncServer()
    server.queries['postgres:info myapp-reports --format json'] = serviceInfoJson('myapp-reports', 'postgres', '17', { ...REPORTS_BACKUP, 'log-driver': 'syslog' })
    const diff = await computeDiff(fakeContext(server).ctx, config)
    expect(diff.services['myapp-reports'].mismatches).toEqual([{ field: 'properties.log-driver', desired: '(not in the file)', current: 'syslog', removed: true }])
  })

  it('redis: mounts: [] removes the mounts the server has, and an absent mounts: leaves them even with --prune', async () => {
    const server = inSyncServer()
    server.queries['redis:info myapp-redis --format json'] = serviceInfoJson('myapp-redis', 'redis', '7.2-alpine', {
      ...REDIS_BACKUP, ...REDIS_PROPERTIES, mounts: '/srv/cache:/data',
    })
    const config = loadConfig(FIXTURE)
    const { ctx, runner } = fakeContext(server)
    await runUp(ctx, config, [], { dryRun: true })
    expect(runner.dryRunLog).toEqual(['redis:unmount --all myapp-redis'])
    delete config.redis!['myapp-redis'].mounts
    const kept = fakeContext(server)
    await runUp(kept.ctx, config, [], { dryRun: true, prune: true })
    expect(kept.runner.dryRunLog).toEqual([])
  })

  it('a key the plugin refuses fails that service only: the run reports it, goes on, and ends in an error', async () => {
    const server = inSyncServer()
    server.queries['postgres:info myapp-db --format json'] = serviceInfoJson('myapp-db', 'postgis/postgis', '17-3.5', { ...DB_PROPERTIES, memory: '256' })
    server.queries['redis:info myapp-redis --format json'] = serviceInfoJson('myapp-redis', 'redis', '7.2-alpine', { ...REDIS_BACKUP, ...REDIS_PROPERTIES, memory: '64' })
    const config = loadConfig(FIXTURE)
    config.postgres!['myapp-db'].properties!['some-future-key'] = 'x'
    const { ctx, runner } = fakeContext(server)
    const run = runner.run
    runner.run = vi.fn(async (...args: string[]) => {
      if (args[0] === 'postgres:set' && args.includes('some-future-key')) throw new Error('Invalid key specified, valid keys include: memory')
      return run(...args)
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(runUp(ctx, config, [], { dryRun: true })).rejects.toThrow('up failed for 1 service(s): postgres:myapp-db')
    expect(runner.dryRunLog).toEqual(['postgres:set myapp-db memory -- 512', 'redis:set myapp-redis memory -- 128'])
  })

  it('--fail-fast stops after a failed service, before any app', async () => {
    const server = inSyncServer()
    server.queries['postgres:info myapp-db --format json'] = serviceInfoJson('myapp-db', 'postgis/postgis', '17-3.5', { ...DB_PROPERTIES, memory: '256' })
    const { ctx, runner } = fakeContext(server)
    runner.run = vi.fn(async (...args: string[]) => { if (args[0] === 'postgres:set') throw new Error('refused') })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(runUp(ctx, loadConfig(FIXTURE), [], { dryRun: true, failFast: true })).rejects.toThrow('up failed for 1 service(s)')
    expect((runner.check as any).mock.calls.some((c: string[]) => c[0] === 'apps:exists')).toBe(false)
  })

  it('a service planned for creation in a dry run gets its properties and mounts on :create, and no set, restart or info read', async () => {
    const server = inSyncServer()
    server.checks['postgres:exists myapp-db'] = false
    delete server.queries['postgres:info myapp-db --format json']
    const { ctx, runner } = fakeContext(server)
    await runUp(ctx, loadConfig(FIXTURE), ['__none__'], { dryRun: true })
    expect(runner.dryRunLog[0]).toBe(
      "postgres:create myapp-db --image postgis/postgis --image-version 17-3.5 --memory 512 --shm-size 256m --restart unless-stopped --post-create-network backend-net,other-net --custom-env 'TZ=UTC;PGOPTIONS=-c work_mem=8MB' --password Zq7-Hk9vbn2 --volume /var/lib/dokku/data/storage/myapp-db-extra:/opt/extra --volume dbvol:/opt/data:ro",
    )
    expect(ctx.serviceRestarts.size).toBe(0)
    expect(maskSensitiveArgs(runner.dryRunLog[0])).not.toContain('Zq7-Hk9vbn2')
  })

  it('a password and custom-env leave no 3-character piece of either in any output of up --dry-run', async () => {
    const config = loadConfig(FIXTURE)
    config.postgres!['myapp-db'].properties!.password = 'Zq7-Wxk9.vBn2'
    config.postgres!['myapp-db'].properties!['custom-env'] = { API_KEY: 'zq7 wxk9 vbn2', TZ: 'Asia/Tokyo' }
    const server = inSyncServer()
    const { ctx, runner } = fakeContext(server)
    await runUp(ctx, config, [], { dryRun: true })
    const listing = runner.dryRunLog.map(maskSensitiveArgs).join('\n')
    const output = listing + lines.join('\n') + formatVerbose(maskDiffResult(await computeDiff(fakeContext(server).ctx, config)))
    for (const secret of ['Zq7-Wxk9.vBn2', 'zq7 wxk9 vbn2', 'Asia/Tokyo']) expect(leaks(output, secret), secret).toEqual([])
    expect(listing).toContain('API_KEY=****;TZ=****')
  })
})
