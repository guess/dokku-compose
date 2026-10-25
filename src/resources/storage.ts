// src/resources/storage.ts
// An app's mounts of named storage entries (`apps.<app>.storage`), converged
// with `storage:mount --replace`, one process type at a time.
import type { Resource } from '../core/reconcile.js'
import type { ListChange } from '../core/change.js'
import type { Context } from '../core/context.js'
import {
  ALL_PHASES, DEFAULT_SCOPE, declaredMounts, scopesOverlap, type Mount, type MountItem, type Phase,
} from '../core/volume-rules.js'
import { readEntries, type ServerEntry } from '../modules/volumes.js'

/**
 * A mount as one string, so the generic list comparison, `diff` and `export`
 * can handle it: the `--replace` spec `entry:container-dir[:tokens]`, with
 * `scope=` in front for a named process type. Tokens: `ro`, `phase=<p>` (only
 * when the mount is not in both phases), the Docker options in order, and,
 * read from a server only, `volume-subpath=` and `volume-chown=` (Dokku stores
 * them but a docker-local deploy never applies them; the next `--replace`
 * clears them).
 */
export interface ParsedSpec {
  scope: string
  entry: string
  dir: string
  readonly: boolean
  phases: Phase[]
  options: string[]
  subpath?: string
  volumeChown?: string
}

export function formatSpec(s: ParsedSpec): string {
  const tokens: string[] = []
  if (s.readonly) tokens.push('ro')
  if (s.phases.length !== ALL_PHASES.length) for (const p of s.phases) tokens.push(`phase=${p}`)
  tokens.push(...s.options)
  if (s.subpath) tokens.push(`volume-subpath=${s.subpath}`)
  if (s.volumeChown) tokens.push(`volume-chown=${s.volumeChown}`)
  const prefix = s.scope === DEFAULT_SCOPE ? '' : `${s.scope}=`
  return `${prefix}${s.entry}:${s.dir}${tokens.length ? `:${tokens.join(',')}` : ''}`
}

export function parseSpec(spec: string): ParsedSpec {
  let scope = DEFAULT_SCOPE
  let rest = spec
  const scoped = spec.match(/^([A-Za-z0-9_-]+)=(.*)$/s)
  if (scoped) { scope = scoped[1]; rest = scoped[2] }
  const first = rest.indexOf(':')
  const entry = rest.slice(0, first)
  const afterEntry = rest.slice(first + 1)
  const second = afterEntry.indexOf(':')
  const dir = second === -1 ? afterEntry : afterEntry.slice(0, second)
  const tokens = second === -1 ? [] : afterEntry.slice(second + 1).split(',').filter(Boolean)
  const parsed: ParsedSpec = { scope, entry, dir, readonly: false, phases: [...ALL_PHASES], options: [] }
  const phases: Phase[] = []
  for (const t of tokens) {
    if (t === 'ro') parsed.readonly = true
    else if (t.startsWith('phase=')) phases.push(t.slice('phase='.length) as Phase)
    else if (t.startsWith('volume-subpath=')) parsed.subpath = t.slice('volume-subpath='.length)
    else if (t.startsWith('volume-chown=')) parsed.volumeChown = t.slice('volume-chown='.length)
    else parsed.options.push(t)
  }
  if (phases.length > 0) parsed.phases = ALL_PHASES.filter(p => phases.includes(p))
  return parsed
}

function mountSpec(m: Mount): string {
  return formatSpec({
    scope: m.process_type, entry: m.entry, dir: m.container_dir, readonly: m.readonly, phases: m.phases, options: m.options,
  })
}

/** What the file wants of an app's mounts; undefined (no action) when the app declares no `storage:`. */
export function desiredSpecs(storage: (string | MountItem)[] | undefined): string[] | undefined {
  return storage === undefined ? undefined : declaredMounts(storage).map(mountSpec)
}

/** The mounts in `storage:report <app> --format json` (`attachment.<n>.*` keys, all strings), as specs. */
export function parseAttachments(raw: string): string[] {
  let report: Record<string, unknown>
  try {
    report = JSON.parse(raw)
  } catch {
    throw new Error(`storage:report --format json did not return JSON: ${raw.slice(0, 80)}`)
  }
  const byIndex = new Map<number, Record<string, string>>()
  for (const [key, value] of Object.entries(report)) {
    const m = key.match(/^attachment\.(\d+)\.(.+)$/)
    if (!m) continue
    const index = Number(m[1])
    byIndex.set(index, { ...byIndex.get(index), [m[2]]: String(value ?? '') })
  }
  return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, a]) => {
    const phases = (a['phases'] ?? '').split(',').filter(p => p === 'deploy' || p === 'run') as Phase[]
    return formatSpec({
      scope: a['process-type'] || DEFAULT_SCOPE,
      entry: a['entry-name'] ?? '',
      dir: a['container-path'] ?? '',
      readonly: a['readonly'] === 'true',
      phases: phases.length > 0 ? ALL_PHASES.filter(p => phases.includes(p)) : [...ALL_PHASES],
      options: (a['volume-options'] ?? '').split(',').filter(Boolean),
      subpath: a['subpath'] || undefined,
      volumeChown: a['volume-chown'] || undefined,
    })
  })
}

/** The part of a spec `--replace` takes (everything but the scope). */
function replaceArg(spec: string): string {
  const p = parseSpec(spec)
  return formatSpec({ ...p, scope: DEFAULT_SCOPE, subpath: undefined, volumeChown: undefined })
}

function byScope(specs: string[]): Map<string, string[]> {
  const scopes = new Map<string, string[]>()
  for (const spec of specs) {
    const scope = parseSpec(spec).scope
    scopes.set(scope, [...(scopes.get(scope) ?? []), spec])
  }
  return scopes
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x))

interface ScopeAction {
  scope: string
  /** The scope's specs after the change; empty clears it. */
  specs: string[]
}

/**
 * The scopes to write, in an order that frees a container dir before another
 * scope claims it (Dokku rejects a dir an overlapping scope still holds).
 */
function orderActions(actions: ScopeAction[], before: Map<string, string[]>): ScopeAction[] {
  const held = new Map<string, Set<string>>()
  for (const [scope, specs] of before) held.set(scope, new Set(specs.map(s => parseSpec(s).dir)))
  const pending = [...actions]
  const ordered: ScopeAction[] = []
  while (pending.length > 0) {
    const index = pending.findIndex(a => a.specs.every(spec => {
      const dir = parseSpec(spec).dir
      return ![...held].some(([scope, dirs]) => scope !== a.scope && scopesOverlap(scope, a.scope) && dirs.has(dir))
    }))
    if (index === -1) {
      throw new Error(`cannot reorder the storage mounts: scopes ${pending.map(a => a.scope).join(', ')} each claim a container dir another still holds. Apply the change in two runs`)
    }
    const [action] = pending.splice(index, 1)
    held.set(action.scope, new Set(action.specs.map(s => parseSpec(s).dir)))
    ordered.push(action)
  }
  return ordered
}

/** What a container sees: (phase, process type, host path, container dir, readonly, options) per mount. */
function containerView(specs: string[], hosts: Map<string, ServerEntry> | undefined): Set<string> {
  const view = new Set<string>()
  for (const spec of specs) {
    const s = parseSpec(spec)
    const host = hosts?.get(s.entry)?.host_path ?? `?${s.entry}`
    for (const phase of s.phases) view.add([phase, s.scope, host, s.dir, s.readonly, s.options.join(',')].join('\0'))
  }
  return view
}

async function entriesOrUndefined(ctx: Context): Promise<Map<string, ServerEntry> | undefined> {
  try { return await readEntries(ctx) } catch { return undefined }
}

export const Storage: Resource<string[]> = {
  key: 'storage',
  read: async (ctx, target) => {
    let raw: string
    try {
      raw = await ctx.queryStrict('storage:report', target, '--format', 'json')
    } catch (err) {
      // An app `up --dry-run` has not created yet has no report: plan from nothing.
      // An existing app whose report fails is an error, never a guess.
      if (!(await ctx.check('apps:exists', target))) return []
      throw err
    }
    return parseAttachments(raw)
  },
  onChange: async (ctx, target, change: ListChange) => {
    // Mounts reach a container when it starts: "Once persistent storage is mounted/unmounted,
    // the app requires a restart" (docs/advanced-usage/persistent-storage.md, v0.38.31).
    // Read the host paths first: the entries behind a legacy mount are still on the server.
    const hostsBefore = await entriesOrUndefined(ctx)
    const before = byScope(change.before)
    const after = byScope(change.after)
    const actions: ScopeAction[] = []
    for (const scope of new Set([...before.keys(), ...after.keys()])) {
      const was = before.get(scope) ?? []
      const now = after.get(scope) ?? []
      if (!sameSet(was, now)) actions.push({ scope, specs: now })
    }

    if (change.after.length === 0) {
      // `storage: []`: every scope goes, in one call.
      await ctx.run('storage:unmount', '--all', target)
    } else {
      for (const { scope, specs } of orderActions(actions, before)) {
        const scopeArgs = scope === DEFAULT_SCOPE ? [] : ['--process-type', scope]
        if (specs.length === 0) await ctx.run('storage:unmount', '--all', target, ...scopeArgs)
        else await ctx.run('storage:mount', '--replace', target, ...specs.map(replaceArg), ...scopeArgs)
      }
    }

    // Only a change in what a container sees needs a restart: swapping an entry for another on the same host path does not.
    const hostsAfter = await entriesOrUndefined(ctx)
    const seenBefore = containerView(change.before, hostsBefore)
    const seenAfter = containerView(change.after, hostsAfter)
    const same = seenBefore.size === seenAfter.size && [...seenBefore].every(x => seenAfter.has(x))
    if (!same) ctx.needsRestart(target, 'storage')
  },
}
