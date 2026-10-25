// The built-in table behind `postgres.<name>.properties` and `redis.<name>.properties`.
// Pure data and string helpers: the schema, `validate`, `up`, `diff` and `export` all read it.
//
// A property is the plugin's own `<plugin>:set` key. The table carries only the keys that need
// care (secrets, restarts, create flags, typed values); every other key the plugin accepts is
// passed through and compared as an exact string.

export type ServicePlugin = 'postgres' | 'redis'

export type PropertyKind =
  | 'string'   // a string or number, compared as written
  | 'number'   // a whole number, written as a decimal string
  | 'list'     // a list, joined with "," and compared as a set
  | 'map'      // custom-env: a map, joined as KEY=value;KEY=value, compared as a set
  | 'secret'   // compared by fingerprint, never printed

export interface PropertySpec {
  kind: PropertyKind
  /** The `<plugin>:create` flag (without `--`) that sets it on a new service */
  createFlag: string
  /** Takes effect only after `<plugin>:stop` and `<plugin>:start` */
  restart: boolean
}

/** The keys dokku-compose manages, in the order the plugin's readme lists them. */
export const MANAGED_PROPERTIES: Record<string, PropertySpec> = {
  'initial-network': { kind: 'string', createFlag: 'initial-network', restart: true },
  'post-create-network': { kind: 'list', createFlag: 'post-create-network', restart: true },
  'post-start-network': { kind: 'list', createFlag: 'post-start-network', restart: true },
  'log-driver': { kind: 'string', createFlag: 'log-driver', restart: true },
  'log-opt': { kind: 'list', createFlag: 'log-opt', restart: true },
  'restart-policy': { kind: 'string', createFlag: 'restart', restart: true },
  'wait-timeout': { kind: 'number', createFlag: 'wait-timeout', restart: false },
  'config-options': { kind: 'string', createFlag: 'config-options', restart: true },
  'custom-env': { kind: 'map', createFlag: 'custom-env', restart: true },
  memory: { kind: 'number', createFlag: 'memory', restart: true },
  'shm-size': { kind: 'string', createFlag: 'shm-size', restart: true },
  password: { kind: 'secret', createFlag: 'password', restart: false },
}

/** Every key `<plugin>:set` lists in dokku-postgres and dokku-redis 2.4.0 (pinned by a test). */
const COMMON_SET_KEYS = [
  'initial-network', 'post-create-network', 'post-start-network',
  'backup-keyserver', 'backup-storage-class', 'backup-object-name', 'backup-timestamp', 'backup-mailto',
  'backup-access-key-id', 'backup-secret-access-key', 'backup-default-region', 'backup-signature-version',
  'backup-endpoint-url', 'backup-encryption-passphrase', 'backup-public-key-id', 'backup-bucket', 'backup-use-iam',
  'log-driver', 'log-opt', 'restart-policy', 'wait-timeout',
  'port-bind-address', 'port-source-range', 'expose-host', 'expose-mode',
]
const TAIL_SET_KEYS = ['volume-targets', 'config-options', 'custom-env', 'memory', 'shm-size', 'password']

export const PLUGIN_SET_KEYS: Record<ServicePlugin, readonly string[]> = {
  postgres: [...COMMON_SET_KEYS, 'export-args', 'import-args', ...TAIL_SET_KEYS],
  redis: [...COMMON_SET_KEYS, ...TAIL_SET_KEYS],
}

/** The plugin version the lists above were taken from. */
export const TESTED_PLUGIN_VERSION = '2.4.0'

/** Keys rejected in `properties:`, with what to do instead. `undefined` for a key that is allowed. */
export function rejectedReason(key: string): string | undefined {
  if (key.startsWith('backup-')) return 'backup settings belong to the `backup:` block'
  if (key.startsWith('expose-') || key === 'port-bind-address' || key === 'port-source-range') {
    return 'exposing a service is not managed yet'
  }
  switch (key) {
    case 'export-args':
    case 'import-args':
      return 'arguments for ad-hoc exports and imports are not managed'
    case 'root-password':
      return 'postgres and redis have no root password'
    case 'volume-targets':
    case 'service-memory':
      return 'rarely needed, so not managed; run `set` by hand'
    case 'image':
    case 'image-version':
    case 'version':
      return 'declare `version` and `image` beside `properties`; `up` never upgrades a service'
    case 'definition':
      return 'the definition a service runs on is changed with upgrade'
    case 'mounts':
      return 'mounts are declared in the `mounts:` key'
    default:
      return undefined
  }
}

/** The managed keys `--prune` may clear: everything but the password, which cannot be cleared. */
export const PRUNABLE_PROPERTIES = Object.keys(MANAGED_PROPERTIES).filter(k => k !== 'password')

export type PropertyValue = string | number | string[] | Record<string, string | number | boolean>

/** The value `<plugin>:set` and `<plugin>:create` take for a declared value. */
export function propertyString(key: string, value: PropertyValue): string {
  if (Array.isArray(value)) return value.map(String).join(',')
  if (typeof value === 'object') return Object.entries(value).map(([k, v]) => `${k}=${v}`).join(';')
  return String(value).trim()
}

const splitSorted = (value: string, sep: string) => value.split(sep).map(s => s.trim()).filter(s => s !== '').sort().join(sep)

/** A value reduced to the form two equal settings share, so the file and the server compare equal. */
export function comparableProperty(key: string, value: string): string {
  switch (MANAGED_PROPERTIES[key]?.kind) {
    case 'list': return splitSorted(value, ',')
    case 'map': return splitSorted(value, ';')
    case 'number': return key === 'memory' && value === '' ? '0' : value.trim()
    default: return value
  }
}

/** Whether the server's value is the plugin's default (an unset key), which `--prune` leaves and `export` skips. */
export function isDefaultProperty(key: string, current: string): boolean {
  return key === 'memory' ? current === '' || current === '0' : current === ''
}

export function sameProperty(key: string, desired: string, current: string): boolean {
  return comparableProperty(key, desired) === comparableProperty(key, current)
}

/** custom-env entries as `[name, value]` pairs; a `;`-joined string and a map are both taken. */
export function customEnvPairs(value: string | Record<string, string | number | boolean>): [string, string][] {
  if (typeof value === 'string') {
    return value.split(';').filter(s => s !== '').map(s => {
      const i = s.indexOf('=')
      return i === -1 ? [s, ''] as [string, string] : [s.slice(0, i), s.slice(i + 1)] as [string, string]
    })
  }
  return Object.entries(value).map(([k, v]) => [k, String(v)] as [string, string])
}

/**
 * A mount spec as `<plugin>:info` reports it (dokku-datastore `Mount.Spec()`):
 * `source:dir[:options]` with `ro` first, `rw` dropped, then other options in order,
 * then `volume-subpath=` and `volume-chown=`; a trailing `:` is dropped.
 */
export function normalizeMount(spec: string): string {
  const parts = spec.split(':')
  const source = parts[0] ?? ''
  const dir = parts[1] ?? ''
  const rest = parts.slice(2).join(':')
  if (rest === '') return `${source}:${dir}`
  let ro = false
  let subpath: string | undefined
  let chown: string | undefined
  const others: string[] = []
  for (const token of rest.split(',')) {
    if (token === 'ro') ro = true
    else if (token === 'rw') continue
    else if (token.startsWith('volume-subpath=')) subpath = token
    else if (token.startsWith('volume-chown=')) chown = token
    else others.push(token)
  }
  const options = [...(ro ? ['ro'] : []), ...others, ...(subpath ? [subpath] : []), ...(chown ? [chown] : [])]
  return options.length ? `${source}:${dir}:${options.join(',')}` : `${source}:${dir}`
}

/** The mounts `<plugin>:info` reports (one space-joined string) as a sorted list of normalised specs. */
export function mountSet(specs: string[]): string[] {
  return [...new Set(specs.map(normalizeMount))].sort()
}

export function parseInfoMounts(raw: string): string[] {
  return mountSet(raw.split(/\s+/).filter(s => s !== ''))
}
