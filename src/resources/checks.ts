import type { Resource } from '../core/reconcile.js'
import type { Change } from '../core/change.js'
import type { Context } from '../core/context.js'
import { parseReport } from './parsers.js'

type ChecksConfig = false | {
  disabled?: string[]
  skipped?: string[]
  [key: string]: string | number | boolean | string[] | undefined
}

export const Checks: Resource<ChecksConfig> = {
  key: 'checks',
  forceApply: true,
  // Applying never reads (forceApply); the read only finds settings to report as removed.
  // Settable state: the per-process lists and `wait-to-retire`. A list of "none" is empty.
  read: async (ctx: Context, target: string) => {
    const report = parseReport(await ctx.query('checks:report', target), 'checks')
    const current: Record<string, string> = {}
    for (const [reportKey, key] of [['disabled-list', 'disabled'], ['skipped-list', 'skipped']]) {
      const v = report[reportKey]
      if (v && v !== 'none' && v !== '_all_') current[key] = v
    }
    if (report['wait-to-retire']) current['wait-to-retire'] = report['wait-to-retire']
    return current as ChecksConfig
  },
  removals: (current, desired) =>
    desired === false ? [] :
    Object.keys(current || {}).filter(k => !(desired && k in desired)),
  onChange: async (ctx, target, { after }: Change<ChecksConfig>) => {
    if (after === false) {
      await ctx.run('checks:disable', target)
      return
    }
    if (after.disabled && after.disabled.length > 0) {
      await ctx.run('checks:disable', target, ...after.disabled)
    }
    if (after.skipped && after.skipped.length > 0) {
      await ctx.run('checks:skip', target, ...after.skipped)
    }
    for (const [key, value] of Object.entries(after)) {
      if (key === 'disabled' || key === 'skipped') continue
      await ctx.run('checks:set', target, key, String(value))
    }
  },
}
