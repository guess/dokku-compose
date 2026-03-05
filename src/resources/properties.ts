import type { Resource } from '../core/reconcile.js'
import type { MapChange, Change } from '../core/change.js'
import type { Context } from '../core/context.js'
import { parseReport, parseBulkReport } from './parsers.js'

function propertyResource(opts: {
  key: string
  namespace: string
  setCmd: string
  afterChange?: string[]
}): Resource<Record<string, string>> {
  return {
    key: opts.key,

    async read(ctx: Context, target: string): Promise<Record<string, string>> {
      const raw = await ctx.query(`${opts.namespace}:report`, target)
      return parseReport(raw, opts.namespace)
    },

    async readAll(ctx: Context): Promise<Map<string, Record<string, string>>> {
      const raw = await ctx.query(`${opts.namespace}:report`)
      return parseBulkReport(raw, opts.namespace)
    },

    async onChange(ctx: Context, target: string, change: MapChange): Promise<void> {
      for (const [key, value] of Object.entries({ ...change.added, ...change.modified })) {
        await ctx.run(opts.setCmd, target, key, String(value))
      }
      if (opts.afterChange) {
        for (const cmd of opts.afterChange) {
          await ctx.run(cmd, target)
        }
      }
    },
  }
}

export const Nginx = propertyResource({
  key: 'nginx',
  namespace: 'nginx',
  setCmd: 'nginx:set',
  afterChange: ['proxy:build-config'],
})

export const Logs = propertyResource({
  key: 'logs',
  namespace: 'logs',
  setCmd: 'logs:set',
})

export const Registry = propertyResource({
  key: 'registry',
  namespace: 'registry',
  setCmd: 'registry:set',
})

export const Scheduler: Resource<string> = {
  key: 'scheduler',

  async read(ctx: Context, target: string): Promise<string> {
    const raw = await ctx.query('scheduler:report', target)
    const report = parseReport(raw, 'scheduler')
    return report['selected'] ?? ''
  },

  async readAll(ctx: Context): Promise<Map<string, string>> {
    const raw = await ctx.query('scheduler:report')
    const bulk = parseBulkReport(raw, 'scheduler')
    const result = new Map<string, string>()
    for (const [app, report] of bulk) {
      result.set(app, report['selected'] ?? '')
    }
    return result
  },

  async onChange(ctx: Context, target: string, change: Change<string>): Promise<void> {
    await ctx.run('scheduler:set', target, 'selected', change.after)
  },
}
