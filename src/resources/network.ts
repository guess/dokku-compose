import type { Resource } from '../core/reconcile.js'
import type { ListChange, Change } from '../core/change.js'
import type { Context } from '../core/context.js'
import { parseReport, parseBulkReport } from './parsers.js'

export const Networks: Resource<string[]> = {
  key: 'networks',
  read: async (ctx, target) => {
    const raw = await ctx.query('network:report', target, '--network-attach-post-deploy')
    return raw.trim() ? raw.trim().split(/\s+/) : []
  },
  readAll: async (ctx: Context) => {
    const raw = await ctx.query('network:report')
    const bulk = parseBulkReport(raw, 'network')
    const result = new Map<string, string[]>()
    for (const [app, report] of bulk) {
      result.set(app, report['attach-post-deploy'] ? report['attach-post-deploy'].split(/\s+/) : [])
    }
    return result
  },
  onChange: async (ctx, target, { after }: ListChange) => {
    await ctx.run('network:set', target, 'attach-post-deploy', ...after)
  },
}

type NetworkPropsConfig = {
  attach_post_create?: string[] | false
  initial_network?: string | false
  bind_all_interfaces?: boolean
  tld?: string | false
}

export const NetworkProps: Resource<NetworkPropsConfig> = {
  key: 'network',
  additive: true,
  removals: (current, desired) =>
    (Object.keys(current ?? {}) as (keyof NetworkPropsConfig)[])
      .filter(k => !(desired && k in desired)),
  read: async (ctx, target) => {
    const raw = await ctx.query('network:report', target)
    const report = parseReport(raw, 'network')
    const config: NetworkPropsConfig = {}
    if (report['attach-post-create']) {
      config.attach_post_create = report['attach-post-create'].split(/\s+/)
    }
    if (report['initial-network']) config.initial_network = report['initial-network']
    if (report['bind-all-interfaces'] === 'true') config.bind_all_interfaces = true
    if (report['tld']) config.tld = report['tld']
    return config
  },
  readAll: async (ctx: Context) => {
    const raw = await ctx.query('network:report')
    const bulk = parseBulkReport(raw, 'network')
    const result = new Map<string, NetworkPropsConfig>()
    for (const [app, report] of bulk) {
      const config: NetworkPropsConfig = {}
      if (report['attach-post-create']) {
        config.attach_post_create = report['attach-post-create'].split(/\s+/)
      }
      if (report['initial-network']) config.initial_network = report['initial-network']
      if (report['bind-all-interfaces'] === 'true') config.bind_all_interfaces = true
      if (report['tld']) config.tld = report['tld']
      result.set(app, config)
    }
    return result
  },
  onChange: async (ctx, target, { after }: Change<NetworkPropsConfig>) => {
    if (after.attach_post_create !== undefined && after.attach_post_create !== false) {
      const nets = Array.isArray(after.attach_post_create)
        ? after.attach_post_create : [after.attach_post_create]
      await ctx.run('network:set', target, 'attach-post-create', ...nets)
    }
    if (after.initial_network !== undefined && after.initial_network !== false) {
      await ctx.run('network:set', target, 'initial-network', after.initial_network)
    }
    if (after.bind_all_interfaces !== undefined) {
      await ctx.run('network:set', target, 'bind-all-interfaces', String(after.bind_all_interfaces))
    }
    if (after.tld !== undefined && after.tld !== false) {
      await ctx.run('network:set', target, 'tld', after.tld)
    }
  },
}
