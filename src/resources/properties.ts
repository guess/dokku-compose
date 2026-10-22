import type { Resource } from '../core/reconcile.js'
import type { MapChange, Change } from '../core/change.js'
import type { Context } from '../core/context.js'
import { parseReport, parseBulkReport, parseJsonReport } from './parsers.js'
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
  'keepalive-timeout', 'lingering-timeout', 'nginx-conf-sigil-path', 'nginx-service-command', 'proxy-buffer-size', 'proxy-buffering',
  'proxy-buffers', 'proxy-busy-buffers-size', 'proxy-connect-timeout', 'proxy-keepalive',
  'proxy-read-timeout', 'proxy-send-timeout', 'send-timeout', 'underscore-in-headers',
  'x-forwarded-for-value', 'x-forwarded-port-value', 'x-forwarded-proto-value', 'x-forwarded-ssl',
] as const
export const LOGS_KEYS = ['app-label-alias', 'max-size', 'vector-cron-sink', 'vector-sink'] as const
/** The top-level `logs:` block also takes the two keys only `logs:set --global` accepts. */
export const LOGS_GLOBAL_KEYS = [...LOGS_KEYS, 'vector-image', 'vector-networks'] as const
/**
 * `auth-servers` is report-only (a registry login, not a `registry:set` key), so it
 * is neither declared nor removed.
 */
export const REGISTRY_KEYS = [
  'image-repo', 'image-repo-template', 'push-extra-tags', 'push-on-release', 'server',
] as const

/** Settable keys that are set on the server and absent from the file. */
function propertyRemovals(allowed: readonly string[]) {
  return (current: Record<string, unknown>, desired: Record<string, unknown> | undefined): string[] =>
    Object.keys(current ?? {}).filter(k => allowed.includes(k) && !(desired && k in desired))
}

/** Return each removed key to Dokku's default: `<setCmd> <app> <key>` with no value. */
function propertyPrune(setCmd: string, afterPrune: string[] = []) {
  return async (ctx: Context, target: string, removed: string[]): Promise<void> => {
    for (const key of removed) await ctx.run(setCmd, target, key)
    for (const cmd of afterPrune) {
      try {
        await ctx.run(cmd, target)
      } catch (err) {
        if (await isAppDeployed(ctx, target)) throw err
        logWarn(target, `${cmd} failed on an undeployed app — its proxy config will be built on first deploy`)
      }
    }
  }
}

function propertyResource(opts: {
  key: string
  namespace: string
  setCmd: string
  settable: readonly string[]
  afterChange?: string[]
  /**
   * Read `<namespace>:report <app> --format json` instead of the stdout report,
   * and skip the bulk read. For logs: the stdout report redacts a sink to
   * `<type>://redacted`, while the json report prints it as set (Dokku 0.38.31
   * `plugins/logs/report.go`, `redactedSink`), so only json compares.
   */
  json?: boolean
}): Resource<Record<string, string>> {
  return {
    key: opts.key,
    // Keys only on the server never make the block "changed"; diff shows them as removals.
    additive: true,
    removals: propertyRemovals(opts.settable),
    prune: propertyPrune(opts.setCmd, opts.afterChange),

    async read(ctx: Context, target: string): Promise<Record<string, string>> {
      if (opts.json) return parseJsonReport(await ctx.queryStrict(`${opts.namespace}:report`, target, '--format', 'json'), opts.settable)
      const raw = await ctx.query(`${opts.namespace}:report`, target)
      return parseReport(raw, opts.namespace)
    },

    ...(opts.json ? {} : {
      async readAll(ctx: Context): Promise<Map<string, Record<string, string>>> {
        const raw = await ctx.query(`${opts.namespace}:report`)
        return parseBulkReport(raw, opts.namespace)
      },
    }),

    async onChange(ctx: Context, target: string, change: MapChange, deferFollowUp = false): Promise<void> {
      for (const [key, value] of Object.entries({ ...change.added, ...change.modified })) {
        await ctx.run(opts.setCmd, target, key, String(value))
      }
      if (opts.afterChange && !deferFollowUp) {
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
  json: true,
})

export const Registry = propertyResource({
  key: 'registry',
  namespace: 'registry',
  setCmd: 'registry:set',
  settable: REGISTRY_KEYS,
})

/** Settable scheduler keys (`scheduler:set`). */
export const SCHEDULER_KEYS = ['selected', 'shell'] as const

/** `scheduler: k3s` is shorthand for `scheduler: { selected: k3s }`. */
export type SchedulerConfig = string | { selected?: string; shell?: string }

function schedulerParts(cfg: SchedulerConfig | undefined): { selected: string; shell: string } {
  if (typeof cfg === 'string') return { selected: cfg, shell: '' }
  return { selected: cfg?.selected ?? '', shell: cfg?.shell ?? '' }
}

/** The server's scheduler state: a bare string while only `selected` is set (as before), else the object. */
function schedulerFromReport(report: Record<string, string>): SchedulerConfig {
  const selected = report['selected'] ?? ''
  const shell = report['shell']
  return shell ? { ...(selected ? { selected } : {}), shell } : selected
}

export const Scheduler: Resource<SchedulerConfig> = {
  key: 'scheduler',
  // A scheduler setting on the app that the file does not declare.
  removals: (current, desired) => {
    const have = schedulerParts(current)
    const want = schedulerParts(desired)
    const removed: string[] = []
    if (have.selected && !want.selected) removed.push('scheduler')
    if (have.shell && !want.shell) removed.push('shell')
    return removed
  },
  prune: async (ctx, target, removed) => {
    for (const label of removed) await ctx.run('scheduler:set', target, label === 'shell' ? 'shell' : 'selected')
  },
  inSync: (current, desired) => {
    const have = schedulerParts(current)
    const want = schedulerParts(desired)
    return (!want.selected || want.selected === have.selected) && (!want.shell || want.shell === have.shell)
  },

  async read(ctx: Context, target: string): Promise<SchedulerConfig> {
    const raw = await ctx.query('scheduler:report', target)
    return schedulerFromReport(parseReport(raw, 'scheduler'))
  },

  async readAll(ctx: Context): Promise<Map<string, SchedulerConfig>> {
    const raw = await ctx.query('scheduler:report')
    const bulk = parseBulkReport(raw, 'scheduler')
    const result = new Map<string, SchedulerConfig>()
    for (const [app, report] of bulk) result.set(app, schedulerFromReport(report))
    return result
  },

  async onChange(ctx: Context, target: string, change: Change<SchedulerConfig>): Promise<void> {
    const have = schedulerParts(change.before)
    const want = schedulerParts(change.after)
    if (want.selected && want.selected !== have.selected) await ctx.run('scheduler:set', target, 'selected', want.selected)
    if (want.shell && want.shell !== have.shell) await ctx.run('scheduler:set', target, 'shell', want.shell)
  },
}
