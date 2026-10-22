import type { Resource } from '../core/reconcile.js'
import type { MapChange } from '../core/change.js'
import type { Context } from '../core/context.js'

// All Dokku command strings and output parsers for process scale and ps
// properties live in this file.

/** ps properties dokku-compose can set (`ps:set`); the schema rejects any other key. */
export const PS_KEYS = ['procfile-path', 'restart-policy', 'stop-timeout-seconds'] as const

/**
 * Parse `dokku ps:scale --format json <app>`:
 * [{"process_type":"web","quantity":1}, ...] into { proc: count }.
 */
export function parseScale(raw: string): Record<string, string> {
  const result: Record<string, string> = {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return result
  }
  if (!Array.isArray(parsed)) return result
  for (const e of parsed) {
    if (e && typeof e.process_type === 'string' && e.quantity !== undefined) {
      result[e.process_type] = String(e.quantity)
    }
  }
  return result
}

/** Parse `dokku ps:report <app> --format json`, keeping only settable, non-empty keys. */
export function parsePsReport(raw: string): Record<string, string> {
  const result: Record<string, string> = {}
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    return result
  }
  if (!parsed || typeof parsed !== 'object') return result
  for (const key of PS_KEYS) {
    const v = parsed[key]
    if (v !== undefined && v !== null && String(v) !== '') result[key] = String(v)
  }
  return result
}

/**
 * Process scale. Additive: a process type that is on the server but absent from
 * the file is left as it is. The scale is applied without deploying, so it takes
 * effect on the next deploy for an app that was never deployed.
 */
export const Scale: Resource<Record<string, string | number>> = {
  key: 'scale',
  additive: true,

  async read(ctx: Context, target: string): Promise<Record<string, string | number>> {
    return parseScale(await ctx.query('ps:scale', '--format', 'json', target))
  },

  async onChange(ctx: Context, target: string, change: MapChange): Promise<void> {
    const pairs = Object.entries({ ...change.added, ...change.modified })
      .map(([proc, count]) => `${proc}=${count}`)
    if (pairs.length === 0) return
    await ctx.run('ps:scale', '--skip-deploy', target, ...pairs)
  },
}

/**
 * ps properties, read per app from `ps:report --format json`. Additive: a
 * settable key that is set on the server but absent from the file is neither
 * not reset by `up`; `diff` shows it as a removal.
 */
export const Ps: Resource<Record<string, string | number>> = {
  key: 'ps',
  additive: true,
  removals: (current, desired) =>
    PS_KEYS.filter(k => current?.[k] !== undefined && !(desired && k in desired)),

  async read(ctx: Context, target: string): Promise<Record<string, string | number>> {
    return parsePsReport(await ctx.queryStrict('ps:report', target, '--format', 'json'))
  },

  async onChange(ctx: Context, target: string, change: MapChange): Promise<void> {
    for (const [key, value] of Object.entries({ ...change.added, ...change.modified })) {
      await ctx.run('ps:set', target, key, String(value))
    }
  },
}
