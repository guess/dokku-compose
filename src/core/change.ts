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
      else if (String(b[key]) !== String(a[key])) modified[key] = a[key]
    }
    const changed = Object.keys(added).length > 0 || removed.length > 0 || Object.keys(modified).length > 0
    return { before, after, changed, added, removed, modified } satisfies MapChange
  }

  // Scalars
  return { before, after, changed: before !== after } satisfies Change
}
