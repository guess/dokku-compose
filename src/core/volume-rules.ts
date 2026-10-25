// Pure rules for `volumes:` and `apps.<app>.storage`, shared by the schema,
// the resources and `export`. Nothing here talks to a server.

/**
 * Dokku's default storage root, `$DOKKU_LIB_ROOT/data/storage`. No Dokku
 * command reports DOKKU_LIB_ROOT, so the default library root is assumed.
 */
export const STORAGE_ROOT = '/var/lib/dokku/data/storage'

/** The process type of a mount that applies to every process. */
export const DEFAULT_SCOPE = '_default_'

export const LEGACY_PREFIX = 'legacy-'
export const MAX_ENTRY_NAME = 45
export const CHOWN_PRESETS = ['herokuish', 'heroku', 'paketo', 'root'] as const
/** What an entry at the default location is chowned to when `chown:` is absent (32767:32767). */
export const DEFAULT_CHOWN = 'herokuish'

const ENTRY_NAME_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/
const DOCKER_VOLUME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/
const PROCESS_TYPE_RE = /^[A-Za-z0-9_-]+$/

export type Phase = 'deploy' | 'run'
export const ALL_PHASES: Phase[] = ['deploy', 'run']

export function defaultPath(name: string): string {
  return `${STORAGE_ROOT}/${name}`
}

export function isLegacyName(name: string): boolean {
  return name.startsWith(LEGACY_PREFIX)
}

/** Whether `name` is a valid entry name (a DNS-1123 label of at most 45 characters). */
export function isValidEntryName(name: string): boolean {
  return name.length <= MAX_ENTRY_NAME && ENTRY_NAME_RE.test(name)
}

export function entryNameError(name: string): string | undefined {
  if (!isValidEntryName(name)) {
    return `'${name}' is not a valid entry name: use lowercase letters, digits and dashes (not at the start or end), at most ${MAX_ENTRY_NAME} characters`
  }
  return undefined
}

/** A normalised absolute path: no trailing slash, no empty, `.` or `..` segment. */
export function isNormalizedAbsolute(p: string): boolean {
  if (!p.startsWith('/')) return false
  return p.split('/').slice(1).every(seg => seg !== '' && seg !== '.' && seg !== '..')
}

/** `path:` of an entry: a normalised absolute directory, or a Docker volume name. */
export function pathError(p: unknown): string | undefined {
  if (typeof p !== 'string' || p === '') return 'path must be a non-empty string'
  if (p.startsWith('/')) {
    return isNormalizedAbsolute(p) ? undefined : `path '${p}' must be normalised: no trailing slash and no empty, '.' or '..' segment`
  }
  return DOCKER_VOLUME_RE.test(p) ? undefined : `path '${p}' must be an absolute directory or a Docker volume name`
}

/** Whether the entry sits at Dokku's default location, where Dokku manages owner and mode. */
export function usesDefaultLocation(name: string, path: string | undefined): boolean {
  return path === undefined || path === defaultPath(name)
}

export function chownError(value: unknown): string | undefined {
  if (value === false) return undefined
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 && value <= 65535 ? undefined : `chown uid ${value} must be an integer from 0 to 65535`
  }
  if (typeof value === 'string') {
    if ((CHOWN_PRESETS as readonly string[]).includes(value)) return undefined
    if (/^\d+$/.test(value) && Number(value) <= 65535) return undefined
  }
  return `chown must be herokuish, heroku, paketo, root, a uid from 0 to 65535, or false (got ${JSON.stringify(value)})`
}

/** The value Dokku stores for a declared `chown`. */
export function chownValue(value: string | number | false): string {
  return String(value)
}

export function modeError(value: unknown): string | undefined {
  if (typeof value === 'number') {
    return `mode must be a quoted octal string: write mode: "${String(value).padStart(4, '0')}" (YAML reads an unquoted ${value} as a number)`
  }
  if (typeof value === 'string' && /^[0-7]{3,4}$/.test(value)) return undefined
  return `mode must be a quoted octal string of 3 or 4 digits, e.g. "0750" (got ${JSON.stringify(value)})`
}

/** The 4-digit form Dokku stores. */
export function normalizeMode(mode: string): string {
  return mode.length === 3 ? `0${mode}` : mode
}

/** One mount as declared: `entry:dir` or the map form, before defaults. */
export interface MountItem {
  entry: string
  container_dir: string
  readonly?: boolean
  phases?: Phase[]
  process_type?: string
  options?: string[]
}

/** A mount with every default filled in. */
export interface Mount {
  entry: string
  container_dir: string
  readonly: boolean
  /** In `deploy`, `run` order. */
  phases: Phase[]
  /** `_default_` for a mount that applies to every process. */
  process_type: string
  options: string[]
}

/** Splits the short form `entry:dir`; an error string when it is anything else. */
export function parseMountString(s: string): MountItem | string {
  if (s.startsWith('/')) {
    return `'${s}' is a host path, which storage no longer takes: declare an entry under volumes: (with path: for an existing directory) and mount it as <entry>:<container-dir>`
  }
  const parts = s.split(':')
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
    return `'${s}' must be <entry>:<container-dir>; options need the map form (entry, container_dir, ...)`
  }
  return { entry: parts[0], container_dir: parts[1] }
}

/** Problems with one declared mount, apart from whether its entry is declared. */
export function mountIssues(m: MountItem): string[] {
  const issues: string[] = []
  if (!isNormalizedAbsolute(m.container_dir) || m.container_dir.includes(':')) {
    issues.push(`container_dir '${m.container_dir}' must be a normalised absolute path without ':'`)
  }
  if (m.process_type !== undefined) {
    if (m.process_type === DEFAULT_SCOPE) issues.push(`process_type '${DEFAULT_SCOPE}' is the default: leave process_type out`)
    else if (!PROCESS_TYPE_RE.test(m.process_type)) issues.push(`process_type '${m.process_type}' must be a Procfile process type (letters, digits, '-' and '_')`)
  }
  for (const o of m.options ?? []) {
    if (o === '') issues.push('options must not hold an empty item')
    else if (o === 'ro' || o === 'rw') issues.push(`options must not hold '${o}': use readonly`)
    else if (/[,=:\s]/.test(o)) issues.push(`option '${o}' must not contain ',', '=', ':' or whitespace (Dokku reads 'key=value' tokens as its own keys)`)
  }
  const phases = m.phases ?? []
  if (new Set(phases).size !== phases.length) issues.push('phases must not repeat a phase')
  return issues
}

export function normalizeMount(m: MountItem): Mount {
  const phases = m.phases && m.phases.length > 0 ? m.phases : ALL_PHASES
  return {
    entry: m.entry,
    container_dir: m.container_dir,
    readonly: m.readonly ?? false,
    phases: ALL_PHASES.filter(p => phases.includes(p)),
    process_type: m.process_type ?? DEFAULT_SCOPE,
    options: m.options ?? [],
  }
}

/** Whether two process-type scopes can apply to one container. */
export function scopesOverlap(a: string, b: string): boolean {
  return a === DEFAULT_SCOPE || b === DEFAULT_SCOPE || a === b
}

/** The declared mounts of an app as normalised mounts; an item that does not parse is left out (the schema reports it). */
export function declaredMounts(storage: (string | MountItem)[] | undefined): Mount[] {
  const mounts: Mount[] = []
  for (const item of storage ?? []) {
    const parsed = typeof item === 'string' ? parseMountString(item) : item
    if (typeof parsed === 'string') continue
    mounts.push(normalizeMount(parsed))
  }
  return mounts
}
