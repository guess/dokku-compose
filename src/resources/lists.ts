// src/resources/lists.ts
import type { Resource } from '../core/reconcile.js'
import { computeChange, type ListChange } from '../core/change.js'
import type { Context } from '../core/context.js'
import { parseBulkReport } from './parsers.js'

function splitWords(raw: string): string[] {
  return raw.split(/\s+/).map(s => s.trim()).filter(Boolean)
}

export const Ports: Resource<string[]> = {
  key: 'ports',
  read: async (ctx, target) => {
    const raw = await ctx.query('ports:report', target, '--ports-map')
    return splitWords(raw)
  },
  readAll: async (ctx: Context) => {
    const raw = await ctx.query('ports:report')
    const bulk = parseBulkReport(raw, 'ports')
    const result = new Map<string, string[]>()
    for (const [app, report] of bulk) {
      result.set(app, report['map'] ? splitWords(report['map']) : [])
    }
    return result
  },
  onChange: async (ctx, target, change: ListChange) => {
    // Ports uses replace-all semantics. Live, never a restart: ports:set fires
    // post-proxy-ports-update, whose nginx-vhosts trigger rebuilds the nginx
    // config (plugins/nginx-vhosts/post-proxy-ports-update, v0.38.31).
    await ctx.run('ports:set', target, ...change.after)
  },
}

/** Dokku prints `true` or `false` (NO_VHOST is not `1`); anything else is unreadable, never a guess. */
function parseEnabled(raw: string): boolean {
  const v = raw.trim()
  if (v === 'true') return true
  if (v === 'false') return false
  throw new Error(`unexpected domains:report --domains-app-enabled output: '${v}'`)
}

/**
 * An app's domains: the vhost list, or `false` when the app's domains are
 * disabled (Dokku 0.38.31 `domains:disable` sets NO_VHOST=1 and removes the
 * VHOST file, so a disabled app has no vhosts to compare).
 */
export const Domains: Resource<string[] | false> = {
  key: 'domains',
  read: async (ctx, target) => {
    let enabledRaw: string
    try {
      enabledRaw = await ctx.queryStrict('domains:report', target, '--domains-app-enabled')
    } catch (err) {
      // An app `up --dry-run` has not created yet has no report: plan from nothing.
      // An existing app whose report fails is an error, never a guess.
      if (!(await ctx.check('apps:exists', target))) return []
      throw err
    }
    const enabled = parseEnabled(enabledRaw)
    if (!enabled) return false
    // Dokku 0.38.31 prints the vhosts space-joined (`normalizeWhitespace` in
    // plugins/domains/report.go), so split on any whitespace, not lines.
    const raw = await ctx.query('domains:report', target, '--domains-app-vhosts')
    return splitWords(raw)
  },
  readAll: async (ctx: Context) => {
    const raw = await ctx.query('domains:report')
    const bulk = parseBulkReport(raw, 'domains')
    const result = new Map<string, string[] | false>()
    for (const [app, report] of bulk) {
      if (report['app-enabled'] === undefined) { result.set(app, splitWords(report['app-vhosts'] ?? '')); continue }
      result.set(app, parseEnabled(report['app-enabled']) ? splitWords(report['app-vhosts'] ?? '') : false)
    }
    return result
  },
  onChange: async (ctx, target, { before, after }: { before: string[] | false | undefined; after: string[] | false }) => {
    if (after === false) {
      await ctx.run('domains:disable', target)
      return
    }
    if (Array.isArray(before)) {
      const { added, removed } = computeChange(before, after)
      for (const d of removed) await ctx.run('domains:remove', target, d)
      for (const d of added) await ctx.run('domains:add', target, d)
      return
    }
    // Disabled or unreadable: enable first. `domains:enable` may write the
    // global default vhosts, which `domains:set` then replaces with the list.
    await ctx.run('domains:enable', target)
    await ctx.run('domains:set', target, ...after)
  },
}
