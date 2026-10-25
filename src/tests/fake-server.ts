// A fake Dokku server for tests: answers reads from fixed tables and records
// every mutation. Reads it was not given throw, so a test sees each command
// the code under test asks for instead of a silent empty answer.
import { vi } from 'vitest'
import { createRunner, type Runner } from '../core/dokku.js'
import { createContext, type Context } from '../core/context.js'

export interface FakeServer {
  /** `query`/`queryStrict` answers, keyed by the space-joined arguments. */
  queries: Record<string, string>
  /** `check` answers, keyed the same way. */
  checks: Record<string, boolean>
  /** `status` exit codes, keyed the same way (stdin input is not part of the key). */
  statuses?: Record<string, number>
}

/** One app's section of a Dokku stdout report, as `<ns>:report <app>` prints it. */
export function report(app: string, title: string, rows: Record<string, string>): string {
  const lines = [`=====> ${app} ${title} information`]
  for (const [key, value] of Object.entries(rows)) lines.push(`       ${key}:`.padEnd(40) + value)
  return lines.join('\n') + '\n'
}

/**
 * `git:report <app>` as Dokku 0.38.31 prints it for an app with nothing set but the
 * deploy branch: the unset `rev-env-var` prints its default and the archive limits
 * print only their computed value.
 */
export function gitReport(app: string, rows: Record<string, string> = {}): string {
  return report(app, 'git', {
    'Git computed archive max files': '10000',
    'Git computed archive max size': '1073741824',
    'Git computed deploy branch': rows['Git deploy branch'] || 'master',
    'Git computed keep git dir': 'false',
    'Git rev env var': 'GIT_REV',
    // Written by Dokku on every `git:from-image`, never by the compose file.
    'Git source image': 'myapp:latest',
    ...rows,
  })
}

/** `proxy:report <app>` as Dokku prints it after an nginx build, which writes the proxy port. */
export function proxyReport(app: string): string {
  return report(app, 'proxy', { 'Proxy enabled': 'true', 'Proxy proxy port': '33059' })
}

/**
 * A dry-run runner whose reads come from `server`. Mutations land in
 * `runner.dryRunLog` (and `ctx.commands`) and never reach a real Dokku.
 */
export function fakeContext(server: FakeServer): { ctx: Context; runner: Runner } {
  const runner = createRunner({ dryRun: true })
  const answer = async (...args: string[]) => {
    const key = args.join(' ')
    if (key in server.queries) return server.queries[key]
    throw new Error(`fake server: no answer for 'dokku ${key}'`)
  }
  runner.query = vi.fn(answer)
  runner.queryStrict = vi.fn(answer)
  runner.check = vi.fn(async (...args: string[]) => {
    const key = args.join(' ')
    if (key in server.checks) return server.checks[key]
    throw new Error(`fake server: no check answer for 'dokku ${key}'`)
  })
  runner.status = vi.fn(async (args: string[]) => {
    const key = args.join(' ')
    if (server.statuses && key in server.statuses) return server.statuses[key]
    throw new Error(`fake server: no status answer for 'dokku ${key}'`)
  })
  return { ctx: createContext(runner), runner }
}

/**
 * What a real Dokku answers for an app or box with nothing set, for the reads
 * that never come back empty: an empty answer to these means the read failed,
 * which dokku-compose treats as unknown. `undefined` for any other read.
 */
export function emptyAnswer(...args: string[]): string | undefined {
  const key = args.join(' ')
  if (/^certs:report \S+ --ssl-enabled$/.test(key)) return 'false'
  if (/^domains:report \S+ --domains-app-enabled$/.test(key)) return 'true'
  if (key === 'logs:report --global --format json') return logsGlobalJson()
  if (key === 'config:export --global --format json') return '{}'
  if (/^config:export --format json \S+$/.test(key)) return '{}'
  if (key === 'nginx:report --global --format json') return nginxGlobalJson()
  const global = key.match(/^(\S+):report --global --format json$/)
  if (global && global[1] in GLOBAL_REPORTS) return globalReportJson(global[1])
  if (/^logs:report \S+ --format json$/.test(key)) return logsAppJson()
  if (/^checks:report \S+$/.test(key)) return '       Checks disabled list: none\n       Checks skipped list: none\n'
  return undefined
}

// Every key Dokku 0.38.31 prints for these JSON reports, values empty where
// unset. logs prints each key twice (bare and `logs-` prefixed,
// `EmitLegacyPrefix: true` in plugins/logs/report.go); nginx --global prints only `global-*`.
const LOGS_PROPS = ['app-label-alias', 'max-size', 'vector-cron-sink', 'vector-image', 'vector-networks', 'vector-sink']
const LOGS_APP_PROPS = ['app-label-alias', 'max-size', 'vector-cron-sink', 'vector-sink']
const NGINX_PROPS = [
  'access-log-format', 'access-log-path', 'bind-address-ipv4', 'bind-address-ipv6', 'client-body-timeout',
  'client-header-timeout', 'client-max-body-size', 'disable-custom-config', 'error-log-path',
  'hsts-include-subdomains', 'hsts-max-age', 'hsts-preload', 'hsts', 'keepalive-timeout', 'lingering-timeout',
  'nginx-conf-sigil-path', 'nginx-service-command', 'proxy-buffer-size', 'proxy-buffering', 'proxy-buffers',
  'proxy-busy-buffers-size', 'proxy-connect-timeout', 'proxy-keepalive', 'proxy-read-timeout',
  'proxy-send-timeout', 'send-timeout', 'underscore-in-headers', 'x-forwarded-for-value',
  'x-forwarded-port-value', 'x-forwarded-proto-value', 'x-forwarded-ssl',
]

function withLegacy(keys: string[], prefix: string): string[] {
  return [...keys, ...keys.map(k => `${prefix}-${k}`)]
}

function fill(keys: string[], values: Record<string, string>): string {
  for (const k of Object.keys(values)) if (!keys.includes(k)) throw new Error(`not a real report key: ${k}`)
  return JSON.stringify(Object.fromEntries(keys.map(k => [k, values[k] ?? ''])))
}

/** `logs:report <app> --format json`, every real key. */
export function logsAppJson(values: Record<string, string> = {}): string {
  const keys = [...LOGS_APP_PROPS, ...LOGS_PROPS.map(p => `computed-${p}`), ...LOGS_PROPS.map(p => `global-${p}`)]
  return fill(withLegacy(keys, 'logs'), values)
}

/** `logs:report --global --format json`, every real key. */
export function logsGlobalJson(values: Record<string, string> = {}): string {
  return fill(withLegacy([...LOGS_PROPS.map(p => `computed-${p}`), ...LOGS_PROPS.map(p => `global-${p}`)], 'logs'), values)
}

/** `nginx:report --global --format json`, every real key. */
export function nginxGlobalJson(values: Record<string, string> = {}): string {
  return fill(NGINX_PROPS.map(p => `global-${p}`), values)
}

/** One mount as `storage:report <app> --format json` prints it; unset fields are empty strings. */
export interface FakeAttachment {
  entry: string
  hostPath: string
  containerPath: string
  phases?: string
  processType?: string
  subpath?: string
  readonly?: boolean
  volumeOptions?: string
  volumeChown?: string
}

/**
 * `storage:report <app> --format json` as Dokku 0.38.31 prints it: the three mount lines, and each
 * attachment's fields twice, as `attachment.<n>.<field>` and `storage-attachment.<n>.<field>`
 * (`EmitLegacyPrefix: true` in plugins/storage/report.go). Every value is a string.
 */
export function storageReportJson(attachments: FakeAttachment[] = []): string {
  const out: Record<string, string> = { 'build-mounts': '', 'deploy-mounts': '', 'run-mounts': '' }
  attachments.forEach((a, i) => {
    const fields: Record<string, string> = {
      'container-path': a.containerPath, 'entry-name': a.entry, 'host-path': a.hostPath,
      phases: a.phases ?? 'deploy,run', 'process-type': a.processType ?? '_default_', readonly: String(a.readonly ?? false),
      subpath: a.subpath ?? '', 'volume-chown': a.volumeChown ?? '', 'volume-options': a.volumeOptions ?? '',
    }
    for (const [k, v] of Object.entries(fields)) {
      out[`attachment.${i + 1}.${k}`] = v
      out[`storage-attachment.${i + 1}.${k}`] = v
    }
  })
  return JSON.stringify(out)
}

/**
 * The keys Dokku 0.38.31 prints for `<ns>:report --global --format json` (Dokku trims the
 * `--<ns>-` prefix): the `global-` keys, and the `computed-` ones its report.go lists for
 * `--global`. Source: `plugins/<ns>/report.go`.
 */
const GLOBAL_REPORTS: Record<string, { global: string[]; computed: string[] }> = {
  scheduler: { global: ['selected', 'shell'], computed: ['selected', 'shell'] },
  registry: {
    global: ['auth-servers', 'push-on-release', 'server', 'image-repo-template', 'push-extra-tags'],
    computed: ['auth-servers', 'push-on-release', 'server', 'image-repo-template', 'push-extra-tags'],
  },
  checks: { global: ['wait-to-retire'], computed: ['wait-to-retire'] },
  ps: {
    global: ['procfile-path', 'restart-policy', 'skip-deploy', 'stop-timeout-seconds'],
    computed: ['procfile-path', 'restart-policy', 'skip-deploy', 'stop-timeout-seconds'],
  },
  builder: { global: ['selected', 'build-dir', 'skip-cleanup'], computed: ['skip-cleanup'] },
  'builder-dockerfile': { global: ['dockerfile-path'], computed: ['dockerfile-path'] },
  'app-json': { global: ['appjson-path'], computed: ['appjson-path'] },
  network: {
    global: ['attach-post-create', 'attach-post-deploy', 'bind-all-interfaces', 'initial-network', 'tld'],
    computed: ['attach-post-create', 'attach-post-deploy', 'bind-all-interfaces', 'initial-network', 'tld'],
  },
  git: {
    global: ['archive-max-files', 'archive-max-size', 'deploy-branch', 'keep-git-dir'],
    computed: ['archive-max-files', 'archive-max-size', 'deploy-branch', 'keep-git-dir'],
  },
}

/**
 * `<ns>:report --global --format json`, every real key. `values` are the global settings by
 * bare key (`'wait-to-retire': '30'`); the matching `computed-` key carries the same value.
 */
export function globalReportJson(ns: string, values: Record<string, string> = {}): string {
  const spec = GLOBAL_REPORTS[ns]
  for (const k of Object.keys(values)) if (!spec.global.includes(k)) throw new Error(`not a real ${ns} global key: ${k}`)
  return JSON.stringify(Object.fromEntries([
    ...spec.computed.map(k => [`computed-${k}`, values[k] ?? '']),
    ...spec.global.map(k => [`global-${k}`, values[k] ?? '']),
  ]))
}

/**
 * `<plugin>:info <svc> --format json` as dokku-postgres 2.4.0 and dokku-redis
 * 2.4.0 print it (a flat object; `image` and `image-version` are the pair
 * `up` created the service with, `version` the image tag the container runs).
 */
export function serviceInfoJson(svc: string, image: string, imageVersion: string, values: Record<string, string> = {}): string {
  return JSON.stringify({
    'backup-schedule': '', 'backup-bucket': '', 'backup-authenticated': 'false', 'backup-auth-fingerprint': '',
    'backup-access-key-id-fingerprint': '', 'backup-secret-access-key-fingerprint': '', 'backup-default-region': '',
    'backup-signature-version': '', 'backup-endpoint-url': '', 'backup-encrypted': 'false',
    'backup-encryption-fingerprint': '', 'backup-public-key-id': '', 'backup-keyserver': '', 'backup-storage-class': '',
    'backup-object-name': '', 'backup-mailto': '', 'backup-timestamp': 'true', 'config-dir': `/var/lib/dokku/services/x/${svc}/config`,
    'data-dir': `/var/lib/dokku/services/x/${svc}/data`, status: 'running',
    service: svc, image, 'image-version': imageVersion, version: `${image}:${imageVersion}`, links: 'myapp',
    ...values,
  })
}
