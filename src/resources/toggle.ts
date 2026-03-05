import type { Resource } from '../core/reconcile.js'
import type { Change } from '../core/change.js'
import type { Context } from '../core/context.js'
import { parseBulkReport } from './parsers.js'

export const Proxy: Resource<boolean> = {
  key: 'proxy',
  read: async (ctx, target) => {
    const raw = await ctx.query('proxy:report', target, '--proxy-enabled')
    return raw.trim() === 'true'
  },
  readAll: async (ctx: Context) => {
    const raw = await ctx.query('proxy:report')
    const bulk = parseBulkReport(raw, 'proxy')
    const result = new Map<string, boolean>()
    for (const [app, report] of bulk) {
      result.set(app, report['enabled'] === 'true')
    }
    return result
  },
  onChange: async (ctx, target, { after }: Change<boolean>) => {
    await ctx.run(after ? 'proxy:enable' : 'proxy:disable', target)
  },
}
