export interface Change<T = unknown> {
  before: T
  after: T
  changed: boolean
}

export interface ListChange extends Change<string[]> {
  added: string[]
  removed: string[]
}

export interface MapChange extends Change<Record<string, string>> {
  added: Record<string, string>
  removed: string[]
  modified: Record<string, string>
}

/** Structural equality: nested maps and lists compare key by key (lists as sets), scalars as strings. */
function sameValue(x: unknown, y: unknown, subset = false): boolean {
  if (x !== null && y !== null && typeof x === 'object' && typeof y === 'object') {
    if (Array.isArray(x) || Array.isArray(y)) {
      if (!Array.isArray(x) || !Array.isArray(y)) return false
      return x.length === y.length && x.every(v => y.some(w => sameValue(v, w))) && y.every(w => x.some(v => sameValue(v, w)))
    }
    const kx = Object.keys(x), ky = Object.keys(y)
    // subset: keys only in x (the server) are ignored, as an additive resource does at the top level
    return (subset ? ky : kx).every(k => k in x && k in y && sameValue((x as any)[k], (y as any)[k], subset)) && (subset || kx.length === ky.length)
  }
  return String(x) === String(y)
}

// Overloads for proper type narrowing at call sites
export function computeChange(before: string[], after: string[]): ListChange
export function computeChange(before: Record<string, string>, after: Record<string, string>): MapChange
export function computeChange<T>(before: T, after: T): Change<T>
export function computeChange(before: unknown, after: unknown): Change | ListChange | MapChange {
  // Null/undefined — existence check
  if (before === null || before === undefined || after === null || after === undefined) {
    return { before, after, changed: before !== after }
  }

  // Arrays — set-based comparison
  if (Array.isArray(before) && Array.isArray(after)) {
    const beforeSet = new Set(before)
    const afterSet = new Set(after)
    const added = after.filter(x => !beforeSet.has(x))
    const removed = before.filter(x => !afterSet.has(x))
    return {
      before, after,
      changed: added.length > 0 || removed.length > 0,
      added,
      removed,
    } satisfies ListChange
  }

  // Objects — key-level diff
  if (typeof before === 'object' && typeof after === 'object') {
    const b = before as Record<string, string>
    const a = after as Record<string, string>
    const allKeys = new Set([...Object.keys(b), ...Object.keys(a)])
    const added: Record<string, string> = {}
    const removed: string[] = []
    const modified: Record<string, string> = {}
    for (const key of allKeys) {
      if (!(key in b)) added[key] = a[key]
      else if (!(key in a)) removed.push(key)
      else if (!sameValue(b[key], a[key])) modified[key] = a[key]
    }
    const changed = Object.keys(added).length > 0 || removed.length > 0 || Object.keys(modified).length > 0
    return { before, after, changed, added, removed, modified } satisfies MapChange
  }

  // Scalars
  return { before, after, changed: before !== after } satisfies Change
}

/**
 * Change for an additive resource: keys only on the server are ignored, and an
 * unreadable (undefined/null) current state counts as empty, never as in sync.
 */
export function computeAdditiveChange(before: unknown, after: unknown): MapChange {
  const change = computeChange((before ?? {}) as Record<string, string>, after as Record<string, string>)
  // Nested maps are additive too: a key only on the server is not a change.
  const b = (before ?? {}) as Record<string, unknown>
  const a = after as Record<string, unknown>
  for (const k of Object.keys(change.modified)) if (sameValue(b[k], a[k], true)) delete change.modified[k]
  change.changed = Object.keys(change.added).length > 0 || Object.keys(change.modified).length > 0
  return change
}
