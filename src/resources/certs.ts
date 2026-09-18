import type { Resource } from '../core/reconcile.js'
import type { Change } from '../core/change.js'
import type { Context } from '../core/context.js'
import { parseBulkReport } from './parsers.js'

// `undefined` means "could not read this" — a real app answers `true` or
// `false` to `--ssl-enabled`; an empty/unreadable report must not be
// coerced into `false`, or an installed cert reads back as missing.
type SslValue = false | true | { certfile: string; keyfile: string } | undefined

export const Certs: Resource<SslValue> = {
  key: 'ssl',
  read: async (ctx, target) => {
    const raw = (await ctx.query('certs:report', target, '--ssl-enabled')).trim()
    if (raw === '') return undefined
    return raw === 'true'
  },
  readAll: async (ctx: Context) => {
    const raw = await ctx.query('certs:report')
    const bulk = parseBulkReport(raw, 'ssl')
    const result = new Map<string, SslValue>()
    for (const [app, report] of bulk) {
      const enabled = report['enabled']
      result.set(app, enabled === undefined ? undefined : enabled === 'true')
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
