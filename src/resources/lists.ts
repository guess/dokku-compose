// src/resources/lists.ts
import type { Resource } from '../core/reconcile.js'
import type { ListChange } from '../core/change.js'
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

export const Domains: Resource<string[]> = {
  key: 'domains',
  read: async (ctx, target) => {
    // Dokku 0.38.31 prints the vhosts space-joined (`normalizeWhitespace` in
    // plugins/domains/report.go), so split on any whitespace, not lines.
    const raw = await ctx.query('domains:report', target, '--domains-app-vhosts')
    return splitWords(raw)
  },
  readAll: async (ctx: Context) => {
    const raw = await ctx.query('domains:report')
    const bulk = parseBulkReport(raw, 'domains')
    const result = new Map<string, string[]>()
    for (const [app, report] of bulk) {
      result.set(app, report['app-vhosts'] ? splitWords(report['app-vhosts']) : [])
    }
    return result
  },
  onChange: async (ctx, target, { added, removed }: ListChange) => {
    for (const d of removed) await ctx.run('domains:remove', target, d)
    for (const d of added) await ctx.run('domains:add', target, d)
  },
}

function parseDeployMounts(raw: string): string[] {
  // Dokku reports deploy mounts as space-separated `-v PATH:PATH` pairs on one line.
  return raw.split(/\s+/).filter(s => s && s !== '-v')
}

export const Storage: Resource<string[]> = {
  key: 'storage',
  read: async (ctx, target) => {
    const raw = await ctx.query('storage:report', target, '--storage-deploy-mounts')
    return parseDeployMounts(raw)
  },
  readAll: async (ctx: Context) => {
    const raw = await ctx.query('storage:report')
    const bulk = parseBulkReport(raw, 'storage')
    const result = new Map<string, string[]>()
    for (const [app, report] of bulk) {
      result.set(app, report['deploy-mounts'] ? parseDeployMounts(report['deploy-mounts']) : [])
    }
    return result
  },
  onChange: async (ctx, target, { added, removed }: ListChange) => {
    // Dokku: "Once persistent storage is mounted/unmounted, the app requires a restart"
    // (docs/advanced-usage/persistent-storage.md, v0.38.31).
    for (const m of removed) {
      await ctx.run('storage:unmount', target, m)
      ctx.needsRestart(target, 'storage')
    }
    for (const m of added) {
      await ctx.run('storage:mount', target, m)
      ctx.needsRestart(target, 'storage')
    }
  },
}
