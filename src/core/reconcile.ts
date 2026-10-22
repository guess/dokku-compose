// src/core/reconcile.ts
import type { Context } from './context.js'
import { computeChange, computeAdditiveChange } from './change.js'
import { logAction, logDone, logSkip } from './logger.js'

export interface Resource<T = unknown> {
  key: string
  read: (ctx: Context, target: string) => Promise<T>
  /** Bulk read for all apps in one SSH call. Used by export/diff. */
  readAll?: (ctx: Context) => Promise<Map<string, T>>
  /** `deferFollowUp`: the caller will run `prune` next, which does the follow-up work (e.g. a proxy rebuild) once. */
  onChange: (ctx: Context, target: string, change: any, deferFollowUp?: boolean) => void | Promise<void>
  /**
   * For a resource whose server state has a different shape from the file's
   * (certs: the installed crt vs the declared file paths): whether `current`
   * already satisfies `desired`. Replaces the generic comparison in `up` and
   * `diff`; onChange then gets `{ before: current, after: desired, changed: true }`.
   * `current` undefined means unreadable and is never in sync.
   */
  inSync?(current: T, desired: T): boolean
  /** Skip diff, always call onChange. For resources without parseable reports. */
  forceApply?: boolean
  /**
   * Only keys present in the desired map count as drift. Keys that exist on the
   * server but not in the desired map are left alone (never reported or removed).
   */
  additive?: boolean
  /**
   * Settings on the server that the file no longer declares (`desired` is
   * undefined when the whole block is gone), as display labels. Computed only
   * over the resource's settable keys, so read-only report lines never appear.
   * `diff` shows them as `-`; nothing here removes them.
   */
  removals?(current: T, desired: T | undefined): string[]
  /**
   * Returns the `removed` settings (from `removals`) to Dokku's defaults. Called
   * only under `up --prune`, after the normal apply. Never destroys anything.
   */
  prune?(ctx: Context, target: string, removed: string[], current: T, desired: T | undefined): Promise<void>
}

export async function reconcile<T>(
  resource: Resource<T>,
  ctx: Context,
  target: string,
  desired: T | undefined,
  /** Called with the removals found in the state this reconcile already read. */
  onRemovals?: (removed: string[]) => void,
  /** `up --prune`: reset the settings the file no longer declares (one extra read when the block is absent or force-applied). */
  prune = false
): Promise<void> {
  const canPrune = prune && !!resource.prune && !!resource.removals
  const pruneFrom = async (current: T) => {
    const removed = resource.removals!(current, desired)
    if (removed.length === 0) return
    logAction(target, `${resource.key} (prune)`)
    await resource.prune!(ctx, target, removed, current, desired)
    logDone()
  }

  if (desired === undefined) {
    if (canPrune) await pruneFrom(await resource.read(ctx, target))
    return
  }
  logAction(target, `${resource.key}`)

  if (resource.forceApply) {
    await resource.onChange(ctx, target, { before: undefined, after: desired, changed: true })
    logDone()
    if (canPrune) await pruneFrom(await resource.read(ctx, target))
    return
  }

  const before = await resource.read(ctx, target)
  if (resource.inSync) {
    if (before !== undefined && resource.inSync(before, desired)) {
      logSkip()
    } else {
      await resource.onChange(ctx, target, { before, after: desired, changed: true })
      logDone()
    }
    if (onRemovals && resource.removals) onRemovals(resource.removals(before, desired))
    if (canPrune) await pruneFrom(before)
    return
  }
  if (onRemovals && resource.removals) onRemovals(resource.removals(before, desired))
  if (canPrune) {
    const change = resource.additive ? computeAdditiveChange(before, desired) : computeChange(before, desired)
    const pending = resource.removals!(before, desired).length > 0
    if (change.changed) {
      await resource.onChange(ctx, target, change, pending)
      logDone()
    } else {
      logSkip()
    }
    await pruneFrom(before)
    return
  }
  const change = resource.additive ? computeAdditiveChange(before, desired) : computeChange(before, desired)
  if (!change.changed) {
    logSkip()
    return
  }
  await resource.onChange(ctx, target, change)
  logDone()
}
