import type { Resource } from '../core/reconcile.js'
import type { MapChange } from '../core/change.js'
import type { Context } from '../core/context.js'
import { parseReport, parseBulkReport } from './parsers.js'

// All Dokku command strings and output parsers for process scale and ps
// properties live in this file. The `ps:scale <app>` output format is assumed
// (see parseScale) and has not been checked against a live box.

/**
 * Parse `dokku ps:scale <app>` output into { proc: count }.
 * Accepts rows like `web: 1`, `web   1` and `-----> web   1` (the table form).
 * Header and separator rows have no numeric count and are skipped.
 */
export function parseScale(raw: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const m = line.replace(/^\s*(-+>\s*)?/, '').match(/^([A-Za-z0-9_-]+)\s*:?\s+(\d+)\s*$/)
    if (m) result[m[1]] = m[2]
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
    return parseScale(await ctx.query('ps:scale', target))
  },

  async onChange(ctx: Context, target: string, change: MapChange): Promise<void> {
    const pairs = Object.entries({ ...change.added, ...change.modified })
      .map(([proc, count]) => `${proc}=${count}`)
    if (pairs.length === 0) return
    await ctx.run('ps:scale', '--skip-deploy', target, ...pairs)
  },
}

/** ps properties (e.g. stop-timeout-seconds), read from `ps:report`. */
export const Ps: Resource<Record<string, string>> = {
  key: 'ps',
  additive: true,

  async read(ctx: Context, target: string): Promise<Record<string, string>> {
    return parseReport(await ctx.query('ps:report', target), 'ps')
  },

  async readAll(ctx: Context): Promise<Map<string, Record<string, string>>> {
    return parseBulkReport(await ctx.query('ps:report'), 'ps')
  },

  async onChange(ctx: Context, target: string, change: MapChange): Promise<void> {
    for (const [key, value] of Object.entries({ ...change.added, ...change.modified })) {
      await ctx.run('ps:set', target, key, String(value))
    }
  },
}
