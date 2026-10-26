// Top-level `volumes:`: named storage entries (Dokku `storage:create`, `storage:set`).
import type { Context } from '../core/context.js'
import type { Config } from '../core/schema.js'
import { logAction, logDone, logSkip, logError } from '../core/logger.js'
import {
  DEFAULT_CHOWN, MAX_ENTRY_NAME, LEGACY_PREFIX, chownValue, defaultPath, isLegacyName, isValidEntryName, normalizeMode,
  pathError, usesDefaultLocation,
} from '../core/volume-rules.js'

export type VolumeConfig = NonNullable<Config['volumes']>[string]

/** An entry as `storage:list-entries --format json` reports it. */
export interface ServerEntry {
  name: string
  scheduler: string
  host_path?: string
  chown?: string
  mode?: string
}

/** The one scheduler dokku-compose manages entries for. */
export const DOCKER_LOCAL = 'docker-local'

/** Every registered entry, by name. Uncached: callers read again after changing entries. */
export async function readEntries(ctx: Context): Promise<Map<string, ServerEntry>> {
  const raw = await ctx.queryStrict('storage:list-entries', '--format', 'json')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`storage:list-entries --format json did not return JSON: ${raw.slice(0, 80)}`)
  }
  if (!Array.isArray(parsed)) throw new Error('storage:list-entries --format json did not return a list')
  const entries = new Map<string, ServerEntry>()
  for (const e of parsed as ServerEntry[]) entries.set(e.name, e)
  return entries
}

/** What the file wants of one entry, with the defaults applied. */
export interface DesiredEntry {
  name: string
  /** A `legacy-<hash>` entry declared as `{}`: it must exist, nothing about it is managed. */
  legacy: boolean
  /** Set only for an entry outside the default location. */
  path?: string
  /** The `chown` value Dokku stores; undefined when not managed (a custom path). */
  chown?: string
  /** 4-digit octal; undefined when not managed. */
  mode?: string
}

export function desiredEntry(name: string, cfg: VolumeConfig): DesiredEntry {
  if (isLegacyName(name)) return { name, legacy: true }
  const atDefault = usesDefaultLocation(name, cfg.path)
  return {
    name,
    legacy: false,
    path: atDefault ? undefined : cfg.path,
    // Dokku manages owner and mode only at the default location; there an absent chown means herokuish.
    chown: atDefault ? (cfg.chown === undefined ? DEFAULT_CHOWN : chownValue(cfg.chown)) : undefined,
    mode: cfg.mode === undefined ? undefined : normalizeMode(String(cfg.mode)),
  }
}

export function desiredEntries(volumes: Record<string, VolumeConfig> | undefined): DesiredEntry[] {
  return Object.entries(volumes ?? {}).map(([name, cfg]) => desiredEntry(name, cfg))
}

/** Where the entry's directory is (or will be). */
export function hostPathOf(d: DesiredEntry): string {
  return d.path ?? defaultPath(d.name)
}

export type EntryState =
  | { kind: 'missing' }
  | { kind: 'ok' }
  | { kind: 'scheduler'; scheduler: string }
  | { kind: 'path'; server: string; want: string }
  | { kind: 'changed'; chown?: { server: string; want: string }; mode?: { server: string; want: string } }

/** How a declared entry stands against the server's. */
export function entryState(d: DesiredEntry, server: ServerEntry | undefined): EntryState {
  if (!server) return { kind: 'missing' }
  if (server.scheduler !== DOCKER_LOCAL) return { kind: 'scheduler', scheduler: server.scheduler }
  if (d.legacy) return { kind: 'ok' }
  const want = hostPathOf(d)
  if ((server.host_path ?? '') !== want) return { kind: 'path', server: server.host_path ?? '', want }
  // `chown: false` and no stored chown both mean Dokku never chowns the directory.
  const chownMatches = d.chown === 'false' ? (server.chown ?? '') === '' || server.chown === 'false' : (server.chown ?? '') === d.chown
  const chown = d.chown !== undefined && !chownMatches ? { server: server.chown ?? '', want: d.chown } : undefined
  const mode = d.mode !== undefined && (server.mode ?? '') !== d.mode ? { server: server.mode ?? '', want: d.mode } : undefined
  return chown || mode ? { kind: 'changed', ...(chown ? { chown } : {}), ...(mode ? { mode } : {}) } : { kind: 'ok' }
}

/** Why `up` cannot converge the entry, or undefined when it can. */
export function stateError(d: DesiredEntry, state: EntryState): string | undefined {
  switch (state.kind) {
    case 'scheduler':
      return `entry '${d.name}' exists on the server with scheduler ${state.scheduler}; dokku-compose manages only docker-local entries`
    case 'path':
      return `entry '${d.name}' is at ${state.server || '(no path)'} on the server but the file says ${state.want}; Dokku cannot change an entry's path. Give the entry a new name in the file, or correct path`
    case 'missing':
      return d.legacy ? `entry '${d.name}' is not on the server; a legacy- entry is made by Dokku, never created here` : undefined
    default:
      return undefined
  }
}

/** The `storage:create` arguments for a missing entry. */
export function createArgs(d: DesiredEntry): string[] {
  const args = ['storage:create', d.name]
  if (d.path !== undefined) args.push(d.path)
  if (d.chown !== undefined) args.push('--chown', d.chown)
  if (d.mode !== undefined) args.push('--mode', d.mode)
  return args
}

const planned = new WeakMap<Context, Map<string, string>>()

/** Host paths of the entries this run created (or, in a dry run, would create), by name. */
export function plannedHostPaths(ctx: Context): Map<string, string> {
  return planned.get(ctx) ?? new Map()
}

/**
 * Create the declared entries that are missing and converge `chown` and `mode`
 * of the ones that exist. An entry that cannot be converged is logged and
 * reported in the result (name -> reason); the others carry on, unless
 * `failFast`, which stops at the first one.
 */
export async function ensureVolumes(
  ctx: Context,
  volumes: Record<string, VolumeConfig>,
  failFast = false
): Promise<Map<string, string>> {
  const failed = new Map<string, string>()
  const server = await readEntries(ctx)
  for (const d of desiredEntries(volumes)) {
    logAction('volumes', `Ensuring ${d.name}`)
    try {
      const state = entryState(d, server.get(d.name))
      const problem = stateError(d, state)
      if (problem) throw new Error(problem)
      if (state.kind === 'missing') {
        await ctx.run(...createArgs(d))
        planned.set(ctx, new Map([...plannedHostPaths(ctx), [d.name, hostPathOf(d)]]))
        logDone()
      } else if (state.kind === 'changed') {
        // chown first: a mode change re-applies the stored chown, so it must already be the new one.
        if (state.chown) await ctx.run('storage:set', d.name, 'chown', state.chown.want)
        if (state.mode) await ctx.run('storage:set', d.name, 'mode', state.mode.want)
        logDone()
      } else {
        logSkip()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.log('')
      logError('volumes', message)
      if (failFast) throw err
      failed.set(d.name, message)
    }
  }
  return failed
}

/** A path component made into the shape of an entry name; '' when nothing usable is left. */
export function sanitizeName(raw: string): string {
  const trim = (n: string) => n.replace(/^-+|-+$/g, '')
  let n = trim(raw.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
  while (n.startsWith(LEGACY_PREFIX)) n = trim(n.slice(LEGACY_PREFIX.length))
  return n.slice(0, MAX_ENTRY_NAME).replace(/-+$/, '')
}

/**
 * Names for the `legacy-<hash>` entries an export has to write under `volumes:`
 * (Dokku reserves the prefix). A name comes from the last component of the host
 * path, else the last two joined with a dash, else the first with `-2`, `-3`, ...
 * It must be valid and not taken: `taken` holds every entry name on the server and
 * is added to as names are given out. null means no valid name: the caller keeps
 * the `legacy-<hash>` name.
 */
export function legacyExportNames(legacy: ServerEntry[], taken: Set<string>): Map<string, string | null> {
  const names = new Map<string, string | null>()
  for (const e of [...legacy].sort((a, b) => a.name.localeCompare(b.name))) {
    const parts = (e.host_path ?? '').split('/').filter(Boolean)
    const last = parts[parts.length - 1] ?? ''
    const two = parts.length > 1 ? `${parts[parts.length - 2]}-${last}` : ''
    const candidates = [sanitizeName(last), sanitizeName(two)].filter(n => n !== '' && isValidEntryName(n))
    let chosen: string | null = candidates.find(n => !taken.has(n)) ?? null
    if (chosen === null && candidates.length > 0) {
      for (let i = 2; i < 100 && chosen === null; i++) {
        const suffix = `-${i}`
        const base = candidates[0].slice(0, MAX_ENTRY_NAME - suffix.length).replace(/-+$/, '')
        if (!taken.has(base + suffix)) chosen = base + suffix
      }
    }
    if (chosen !== null) taken.add(chosen)
    names.set(e.name, chosen)
  }
  return names
}

type ExportedVolume = NonNullable<Config['volumes']>[string]

function exportedChown(stored: string | undefined): string | number | false {
  if (stored === undefined || stored === '' || stored === 'false') return false
  return /^\d+$/.test(stored) ? Number(stored) : stored
}

/**
 * The `volumes:` block of an export, and the name each entry an app mounts goes by in the file.
 * Entries of other schedulers are left out; so is a legacy entry nothing mounts.
 * `onlyMounted` limits the block to the entries `mounted` names (an export of some apps).
 */
export function exportVolumes(
  server: Map<string, ServerEntry>,
  mounted: Set<string>,
  onlyMounted = false
): { volumes: Record<string, ExportedVolume>; names: Map<string, string> } {
  const volumes: Record<string, ExportedVolume> = {}
  const names = new Map<string, string>()
  const dockerLocal = [...server.values()].filter(e => e.scheduler === DOCKER_LOCAL)

  const describe = (name: string, e: ServerEntry): ExportedVolume => {
    const atDefault = (e.host_path ?? '') === defaultPath(name)
    if (!atDefault) return { path: e.host_path }
    // An exported entry keeps its directory as it is: an unset chown is written as false, never as the herokuish default.
    return { chown: exportedChown(e.chown), ...(e.mode ? { mode: e.mode } : {}) }
  }

  for (const e of dockerLocal.filter(e => !isLegacyName(e.name)).sort((a, b) => a.name.localeCompare(b.name))) {
    if (onlyMounted && !mounted.has(e.name)) continue
    volumes[e.name] = describe(e.name, e)
    names.set(e.name, e.name)
  }

  const used = dockerLocal.filter(e => isLegacyName(e.name) && mounted.has(e.name))
  const given = legacyExportNames(used, new Set(server.keys()))
  for (const e of used) {
    const name = given.get(e.name)
    // A host path that is not a valid `path:` cannot be written either: keep Dokku's name for it.
    if (name == null || pathError(e.host_path) !== undefined) {
      volumes[e.name] = {}
      names.set(e.name, e.name)
      continue
    }
    volumes[name] = describe(name, e)
    names.set(e.name, name)
  }
  return { volumes, names }
}
