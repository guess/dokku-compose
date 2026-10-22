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

/** Settable keys per property namespace (`<namespace>:set`); only these can be reported as removed. */
export const NGINX_KEYS = [
  'access-log-format', 'access-log-path', 'bind-address-ipv4', 'bind-address-ipv6',
  'client-body-timeout', 'client-header-timeout', 'client-max-body-size', 'disable-custom-config',
  'error-log-path', 'hsts', 'hsts-include-subdomains', 'hsts-max-age', 'hsts-preload',
  'keepalive-timeout', 'lingering-timeout', 'proxy-buffer-size', 'proxy-buffering',
  'proxy-buffers', 'proxy-busy-buffers-size', 'proxy-connect-timeout', 'proxy-keepalive',
  'proxy-read-timeout', 'proxy-send-timeout', 'send-timeout', 'underscore-in-headers',
  'x-forwarded-for-value', 'x-forwarded-port-value', 'x-forwarded-proto-value', 'x-forwarded-ssl',
] as const
export const LOGS_KEYS = ['app-label-alias', 'max-size', 'vector-cron-sink', 'vector-sink'] as const
export const REGISTRY_KEYS = [
  'auth-servers', 'image-repo', 'image-repo-template', 'push-extra-tags', 'push-on-release', 'server',
] as const

/** Settable keys that are set on the server and absent from the file. */
function propertyRemovals(allowed: readonly string[]) {
  return (current: Record<string, unknown>, desired: Record<string, unknown> | undefined): string[] =>
    Object.keys(current ?? {}).filter(k => allowed.includes(k) && !(desired && k in desired))
}

function propertyResource(opts: {
  key: string
  namespace: string
  setCmd: string
  settable: readonly string[]
  afterChange?: string[]
}): Resource<Record<string, string>> {
  return {
    key: opts.key,
    // Keys only on the server never make the block "changed"; diff shows them as removals.
    additive: true,
    removals: propertyRemovals(opts.settable),

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
  settable: NGINX_KEYS,
  afterChange: ['proxy:build-config'],
})

export const Logs = propertyResource({
  key: 'logs',
  namespace: 'logs',
  setCmd: 'logs:set',
  settable: LOGS_KEYS,
})

export const Registry = propertyResource({
  key: 'registry',
  namespace: 'registry',
  setCmd: 'registry:set',
  settable: REGISTRY_KEYS,
})

export const Scheduler: Resource<string> = {
  key: 'scheduler',
  // A scheduler selected on the app but not declared in the file.
  removals: (current, desired) => (desired === undefined && current ? ['scheduler'] : []),

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
