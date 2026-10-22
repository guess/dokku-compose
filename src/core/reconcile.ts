// src/core/reconcile.ts
import type { Context } from './context.js'
import { computeChange, computeAdditiveChange } from './change.js'
import { logAction, logDone, logSkip } from './logger.js'

export interface Resource<T = unknown> {
  key: string
  read: (ctx: Context, target: string) => Promise<T>
  /** Bulk read for all apps in one SSH call. Used by export/diff. */
  readAll?: (ctx: Context) => Promise<Map<string, T>>
  onChange: (ctx: Context, target: string, change: any) => void | Promise<void>
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
}

export async function reconcile<T>(
  resource: Resource<T>,
  ctx: Context,
  target: string,
  desired: T | undefined
): Promise<void> {
  if (desired === undefined) return
  logAction(target, `${resource.key}`)

  if (resource.forceApply) {
    await resource.onChange(ctx, target, { before: undefined, after: desired, changed: true })
    logDone()
    return
  }

  const before = await resource.read(ctx, target)
  const change = resource.additive ? computeAdditiveChange(before, desired) : computeChange(before, desired)
  if (!change.changed) {
    logSkip()
    return
  }
  await resource.onChange(ctx, target, change)
  logDone()
}
