import type { Resource } from '../core/reconcile.js'
import type { Change } from '../core/change.js'
import type { Context } from '../core/context.js'
import { parseBulkReport } from './parsers.js'

type SslValue = false | true | { certfile: string; keyfile: string }

export const Certs: Resource<SslValue> = {
  key: 'ssl',
  read: async (ctx, target) => {
    const raw = await ctx.query('certs:report', target, '--ssl-enabled')
    return raw.trim() === 'true'
  },
  readAll: async (ctx: Context) => {
    const raw = await ctx.query('certs:report')
    const bulk = parseBulkReport(raw, 'ssl')
    const result = new Map<string, SslValue>()
    for (const [app, report] of bulk) {
      result.set(app, report['enabled'] === 'true')
    }
    return result
  },
  onChange: async (ctx, target, { before, after }: Change<SslValue>) => {
    if (after === false && before) {
      await ctx.run('certs:remove', target)
    }
    if (after && typeof after === 'object') {
      await ctx.run('certs:add', target, after.certfile, after.keyfile)
    }
  },
}
