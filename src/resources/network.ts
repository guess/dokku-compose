import type { Resource } from '../core/reconcile.js'
import type { ListChange, Change } from '../core/change.js'
import type { Context } from '../core/context.js'
import { parseReport, parseBulkReport } from './parsers.js'

/**
 * Every `network:set` key (Dokku 0.38.31 `plugins/network/network.go`). `attach-post-deploy`
 * is the `networks:` list; the rest are the `network:` block.
 */
export const NETWORK_KEYS = [
  'attach-post-create', 'attach-post-deploy', 'bind-all-interfaces', 'initial-network', 'static-web-listener', 'tld',
] as const

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
    // docs/networking/network.md:210 (v0.38.31): "A change in these values will
    // require an app deploy or rebuild" (attach-post-create, attach-post-deploy,
    // initial-network). A restart is not named, so print a rebuild.
    ctx.needsRebuild(target, 'networks')
  },
}

type NetworkPropsConfig = {
  attach_post_create?: string[] | false
  initial_network?: string | false
  bind_all_interfaces?: boolean
  static_web_listener?: string | false
  tld?: string | false
}

export const NetworkProps: Resource<NetworkPropsConfig> = {
  key: 'network',
  additive: true,
  removals: (current, desired) =>
    (Object.keys(current ?? {}) as (keyof NetworkPropsConfig)[])
      .filter(k => !(desired && k in desired)),
  // Dokku's property names are hyphenated; the schema's are underscored.
  prune: async (ctx, target, removed) => {
    for (const key of removed) {
      await ctx.run('network:set', target, key.replaceAll('_', '-'))
      if (key === 'attach_post_create' || key === 'initial_network') ctx.needsRebuild(target, 'network')
      else ctx.needsRestart(target, 'network')
    }
  },
  read: async (ctx, target) => {
    const raw = await ctx.query('network:report', target)
    const report = parseReport(raw, 'network')
    const config: NetworkPropsConfig = {}
    if (report['attach-post-create']) {
      config.attach_post_create = report['attach-post-create'].split(/\s+/)
    }
    if (report['initial-network']) config.initial_network = report['initial-network']
    if (report['bind-all-interfaces'] === 'true') config.bind_all_interfaces = true
    if (report['static-web-listener']) config.static_web_listener = report['static-web-listener']
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
      if (report['static-web-listener']) config.static_web_listener = report['static-web-listener']
      if (report['tld']) config.tld = report['tld']
      result.set(app, config)
    }
    return result
  },
  // `false` clears a property, so it is in sync when the server has no value; a
  // declared value must match what the server reports.
  inSync: (current, desired) =>
    (Object.keys(desired) as (keyof NetworkPropsConfig)[]).every(k => propInSync(current, desired, k)),
  onChange: async (ctx, target, { before, after }: Change<NetworkPropsConfig>) => {
    const todo = (k: keyof NetworkPropsConfig) => after[k] !== undefined && !propInSync(before, after, k)
    for (const [key, restart] of [
      ['attach_post_create', false], ['initial_network', false], ['bind_all_interfaces', true],
      ['static_web_listener', null], ['tld', true],
    ] as const) {
      if (!todo(key)) continue
      const value = after[key]
      const args = value === false && key !== 'bind_all_interfaces' ? []
        : Array.isArray(value) ? value : [String(value)]
      await ctx.run('network:set', target, key.replaceAll('_', '-'), ...args)
      if (restart === false) ctx.needsRebuild(target, 'network')
      else if (restart) ctx.needsRestart(target, 'network')
    }
  },
}

/** One declared key against the server. `false` (clear) matches an unset key; bind_all_interfaces: false matches unless the server reports true. */
function propInSync(current: NetworkPropsConfig | undefined, desired: NetworkPropsConfig, key: keyof NetworkPropsConfig): boolean {
  const want = desired[key]
  const have = current?.[key]
  if (want === undefined) return true
  if (key === 'bind_all_interfaces') return (want === true) === (have === true)
  if (want === false) return have === undefined
  if (have === undefined || have === false) return false
  const w = Array.isArray(want) ? want : [want as string]
  const h = Array.isArray(have) ? have : [have as string]
  return w.length === h.length && w.every(v => h.includes(v))
}
