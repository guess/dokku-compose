// src/core/reconcile.ts
import type { Context } from './context.js'
import { computeChange } from './change.js'
import { logAction, logDone, logSkip } from './logger.js'

export interface Resource<T = unknown> {
  key: string
  read: (ctx: Context, target: string) => Promise<T>
  /** Bulk read for all apps in one SSH call. Used by export/diff. */
  readAll?: (ctx: Context) => Promise<Map<string, T>>
  onChange: (ctx: Context, target: string, change: any) => void | Promise<void>
  /** Skip diff, always call onChange. For resources without parseable reports. */
  forceApply?: boolean
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
  const change = computeChange(before, desired)
  if (!change.changed) {
    logSkip()
    return
  }
  await resource.onChange(ctx, target, change)
  logDone()
}
