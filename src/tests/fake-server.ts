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
  if (key === 'nginx:report --global --format json') return nginxGlobalJson()
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

/**
 * `<plugin>:info <svc> --format json` as dokku-postgres 2.4.0 and dokku-redis
 * 2.4.0 print it (a flat object; `image` and `image-version` are the pair
 * `up` created the service with, `version` the image tag the container runs).
 */
export function serviceInfoJson(svc: string, image: string, imageVersion: string, values: Record<string, string> = {}): string {
  return JSON.stringify({
    'backup-schedule': '', 'backup-bucket': '', 'config-dir': `/var/lib/dokku/services/x/${svc}/config`,
    'data-dir': `/var/lib/dokku/services/x/${svc}/data`, status: 'running',
    service: svc, image, 'image-version': imageVersion, version: `${image}:${imageVersion}`, links: 'myapp',
    ...values,
  })
}
