import type { Resource } from '../core/reconcile.js'
import type { Change } from '../core/change.js'
import type { Context } from '../core/context.js'
import type { MapChange } from '../core/change.js'
import { parseReport, parseBulkReport } from './parsers.js'

/** Every `proxy:set` key (Dokku 0.38.31 `plugins/proxy/proxy.go`); `disabled` is the `proxy.enabled` toggle. */
export const PROXY_KEYS = ['disabled', 'proxy-port', 'proxy-ssl-port', 'type'] as const

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

export type ProxyPropsConfig = { type?: string; proxy_port?: string | number; proxy_ssl_port?: string | number }

const PROXY_PROP_KEYS = ['type', 'proxy_port', 'proxy_ssl_port'] as const

function proxyPropsFromReport(report: Record<string, string>): ProxyPropsConfig {
  const config: ProxyPropsConfig = {}
  if (report['type']) config.type = report['type']
  if (report['proxy-port']) config.proxy_port = report['proxy-port']
  if (report['proxy-ssl-port']) config.proxy_ssl_port = report['proxy-ssl-port']
  return config
}

/** The `proxy:` block's `proxy:set` properties (`type`, `proxy_port`, `proxy_ssl_port`); `enabled` is `Proxy`. */
export const ProxyProps: Resource<ProxyPropsConfig> = {
  key: 'proxy_props',
  additive: true,
  // Dokku writes `proxy-port` and `proxy-ssl-port` itself on every nginx build, so they are
  // compared only when declared and are never removals; only `type` is the user's to remove.
  removals: (current, desired) =>
    (['type'] as const).filter(k => current?.[k] !== undefined && !(desired && k in desired)),
  prune: async (ctx, target, removed) => {
    for (const key of removed) await ctx.run('proxy:set', target, key.replaceAll('_', '-'))
  },
  read: async (ctx, target) => proxyPropsFromReport(parseReport(await ctx.query('proxy:report', target), 'proxy')),
  readAll: async (ctx: Context) => {
    const bulk = parseBulkReport(await ctx.query('proxy:report'), 'proxy')
    return new Map([...bulk].map(([app, report]) => [app, proxyPropsFromReport(report)]))
  },
  onChange: async (ctx, target, change: MapChange) => {
    for (const [key, value] of Object.entries({ ...change.added, ...change.modified })) {
      await ctx.run('proxy:set', target, key.replaceAll('_', '-'), String(value))
    }
  },
}

/** The `proxy:set` part of a `proxy:` block, or undefined when it declares none. */
export function proxyProps(proxy: ({ enabled?: boolean } & ProxyPropsConfig) | undefined): ProxyPropsConfig | undefined {
  if (!proxy) return undefined
  const props: ProxyPropsConfig = {}
  for (const k of PROXY_PROP_KEYS) if (proxy[k] !== undefined) (props as Record<string, unknown>)[k] = proxy[k]
  return Object.keys(props).length > 0 ? props : undefined
}
