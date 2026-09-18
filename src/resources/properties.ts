import type { Resource } from '../core/reconcile.js'
import type { MapChange, Change } from '../core/change.js'
import type { Context } from '../core/context.js'
import { parseReport, parseBulkReport } from './parsers.js'
import { logWarn } from '../core/logger.js'

/**
 * Whether `target` has ever completed a deploy. Dokku's exit code for
 * `proxy:build-config` on a created-but-never-deployed app isn't confirmed,
 * so callers use this to decide whether a failure there is expected (first
 * deploy hasn't happened, nginx config will be built then) or real. An
 * unreadable answer is treated as "not deployed" — the safer assumption,
 * since it's also true for a genuinely fresh app.
 */
async function isAppDeployed(ctx: Context, target: string): Promise<boolean> {
  const raw = await ctx.query('ps:report', target, '--deployed')
  return raw.trim() === 'true'
}

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
          try {
            await ctx.run(cmd, target)
          } catch (err) {
            if (await isAppDeployed(ctx, target)) throw err
            // The app exists but has never been deployed — dokku's
            // rebuild-the-proxy-config step can fail here with nothing to
            // build yet. It will be built on first deploy, so this isn't a
            // real failure; surface it as a warning and continue.
            logWarn(target, `${cmd} failed on an undeployed app — its proxy config will be built on first deploy`)
          }
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
