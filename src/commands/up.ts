import type { Context } from '../core/context.js'
import type { Config } from '../core/schema.js'
import { reconcile } from '../core/reconcile.js'
import type { Resource } from '../core/reconcile.js'
import { Apps } from '../resources/lifecycle.js'
import { Domains, Ports } from '../resources/lists.js'
import { Storage, desiredSpecs } from '../resources/storage.js'
import { Nginx, Logs, Registry, Scheduler } from '../resources/properties.js'
import { Proxy, ProxyProps, proxyProps } from '../resources/toggle.js'
import { Config as ConfigResource } from '../resources/config.js'
import { Certs } from '../resources/certs.js'
import { Builder } from '../resources/builder.js'
import { DockerOptions } from '../resources/docker-options.js'
import { Scale, Ps } from '../resources/ps.js'
import { Git } from '../resources/git.js'
import { Checks } from '../resources/checks.js'
import { Networks, NetworkProps } from '../resources/network.js'
import { ensurePlugins } from '../modules/plugins.js'
import { ensureDockerAuth, pruneDockerAuth } from '../modules/docker-auth.js'
import { ensureNetworks } from '../modules/network.js'
import { ensurePostgres, removeBackupHashKeys } from '../modules/postgres.js'
import { ensureServiceBackups } from '../modules/service-backup.js'
import { ensureVolumes } from '../modules/volumes.js'
import { ensureRedis } from '../modules/redis.js'
import { assertDokkuSupported, enforceFileVersion } from '../modules/version.js'
import { ensureAppLinks } from '../modules/links.js'
import { ensureGlobalDomains } from '../modules/domains.js'
import { ensureGlobalConfig } from '../modules/config.js'
import { ensureGlobal, GLOBAL_UP_ORDER } from '../modules/global.js'
import { logError, logWarn } from '../core/logger.js'
import type { AppConfig } from '../core/schema.js'
import { declaredMounts, type MountItem } from '../core/volume-rules.js'

export interface RunUpOptions {
  /** Stop at the first per-app failure instead of continuing to the next app. */
  failFast?: boolean
  /** Reset settings the file no longer declares (nginx, logs, registry, scheduler, ps, network, checks, build args). */
  prune?: boolean
  /** The run is a dry run: the restart summary says "would need". */
  dryRun?: boolean
}

/**
 * Mark every app this run processes as needing a restart for a global env
 * change. Call it only when a global key was actually set or unset (global env
 * is read when a container starts); an unchanged run must not call it.
 */
export function markGlobalEnvRestart(ctx: Context, apps: string[], reason = 'global env'): void {
  for (const app of apps) ctx.needsRestart(app, reason)
}

/** Print the apps whose applied changes need `dokku ps:restart`. Nothing is restarted (no --restart flag by design). */
export function printRestartSummary(ctx: Context, dryRun = false): void {
  // A rebuild restarts the app, so an app needing both shows only the rebuild line.
  const restarts = [...ctx.restarts].filter(([app]) => !ctx.rebuilds.has(app))
  if (restarts.length === 0 && ctx.rebuilds.size === 0) return
  console.log(`\n# Apps that ${dryRun ? 'would need' : 'need'} a restart or rebuild:`)
  for (const [app, reasons] of restarts) console.log(`dokku ps:restart ${app}  # ${reasons.join(', ')}`)
  for (const [app, reasons] of ctx.rebuilds) console.log(`dokku ps:rebuild ${app}  # ${reasons.join(', ')}`)
}

/** Thrown by runUp when one or more apps failed during the per-app phase. */
export class UpFailedError extends Error {
  constructor(public readonly failures: { app: string; error: unknown }[]) {
    super(
      `up failed for ${failures.length} app(s): ${failures.map(f => f.app).join(', ')}`
    )
    this.name = 'UpFailedError'
  }
}

/** Thrown by processApp when one or more of an app's resources failed (each already logged). */
class AppStepsError extends AggregateError {
  constructor(errors: unknown[]) {
    super(errors, errors.map(e => e instanceof Error ? e.message : String(e)).join('; '))
    this.name = 'AppStepsError'
  }
}

async function processApp(
  ctx: Context, config: Config, app: string, appConfig: AppConfig, failFast = false, prune = false,
  failedVolumes: Map<string, string> = new Map()
): Promise<void> {
  // A resource that throws is recorded and the rest of the app still runs,
  // so one broken resource cannot hide another (e.g. env never being reached).
  const errors: unknown[] = []
  // Settings that left a declared block stay on the box (env keys are always
  // unset; lists are pruned). Counted from reads reconcile already made.
  let leftOnServer = 0
  const count = prune ? undefined : (removed: string[]) => { leftOnServer += removed.length }
  const step = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn()
    } catch (error) {
      if (failFast) throw error
      logError(app, error instanceof Error ? error.message : String(error))
      errors.push(error)
    }
  }

  // Lifecycle
  // Without the app nothing else can work: stop here instead of flooding
  // the log with follow-on failures.
  await reconcile(Apps, ctx, app, true)

  // Networking
  await step(() => reconcile(Domains, ctx, app, appConfig.domains))
  await step(() => reconcile(Networks, ctx, app, appConfig.networks))
  await step(() => reconcile(NetworkProps, ctx, app, appConfig.network, count, prune))
  await step(() => reconcile(Proxy, ctx, app, appConfig.proxy?.enabled))
  await step(() => reconcile(ProxyProps, ctx, app, proxyProps(appConfig.proxy), count, prune))
  await step(() => reconcile(Ports, ctx, app, appConfig.ports))

  // Links (between networking and config)
  if (config.postgres || config.redis) {
    await step(() => ensureAppLinks(ctx, app, appConfig.links ?? [], config))
  }

  // Configuration
  await step(() => reconcile(Certs, ctx, app, appConfig.ssl))
  await step(async () => {
    // An entry that could not be created or converged cannot be mounted.
    const failedEntries = [...new Set(declaredMounts(appConfig.storage as (string | MountItem)[] | undefined).map(m => m.entry))].filter(e => failedVolumes.has(e))
    if (failedEntries.length > 0) {
      throw new Error(`storage skipped: ${failedEntries.map(e => `entry '${e}' failed (${failedVolumes.get(e)})`).join('; ')}`)
    }
    await reconcile(Storage, ctx, app, desiredSpecs(appConfig.storage))
  })
  await step(() => reconcile(Nginx, ctx, app, appConfig.nginx, count, prune))
  await step(() => reconcile(Checks, ctx, app, appConfig.checks, undefined, prune))
  await step(() => reconcile(Logs, ctx, app, appConfig.logs, count, prune))
  await step(() => reconcile(Registry, ctx, app, appConfig.registry, count, prune))
  await step(() => reconcile(Scheduler, ctx, app, appConfig.scheduler, count, prune))
  await step(() => reconcile(Ps, ctx, app, appConfig.ps, count, prune))
  await step(() => reconcile(Scale, ctx, app, appConfig.scale))
  await step(() => reconcile(ConfigResource, ctx, app, appConfig.env || {}))

  // Build
  await step(() => reconcile(Builder, ctx, app, appConfig.build, count, prune))
  await step(() => reconcile(Git, ctx, app, appConfig.git ?? config.git, count, prune))
  await step(() => reconcile(DockerOptions, ctx, app, appConfig.docker_options))

  if (leftOnServer > 0) {
    logWarn(app, `${leftOnServer} setting(s) no longer in the compose file were left on the server; run 'dokku-compose diff' to see them`)
  }

  if (errors.length > 0) throw new AppStepsError(errors)
}

export async function runUp(
  ctx: Context,
  config: Config,
  appFilter: string[],
  opts: RunUpOptions = {}
): Promise<void> {
  try {
    await runUpPhases(ctx, config, appFilter, opts)
  } finally {
    // Also after a partial failure: applied changes still wait for a restart.
    printRestartSummary(ctx, opts.dryRun)
  }
}

async function runUpPhases(
  ctx: Context,
  config: Config,
  appFilter: string[],
  opts: RunUpOptions
): Promise<void> {
  const apps = appFilter.length > 0
    ? appFilter
    : Object.keys(config.apps)

  // Global phases: every app depends on these, so a failure here aborts the
  // whole run immediately, regardless of --fail-fast.

  // Phase 0: Version check
  enforceFileVersion(await assertDokkuSupported(ctx), config.dokku?.version)

  // Phase 1: Plugins & host-level auth
  if (config.plugins) await ensurePlugins(ctx, config.plugins)
  if (config.docker_auth) {
    await ensureDockerAuth(ctx, config.docker_auth)
    if (opts.prune) await pruneDockerAuth(ctx, config.docker_auth)
  }

  // Phase 2: Global config
  if (config.domains !== undefined) await ensureGlobalDomains(ctx, config.domains)
  // Global env reaches a container only when it starts: list the apps this run
  // processes for restart, and only when a key was actually set or unset.
  if (await ensureGlobalConfig(ctx, config.env)) {
    markGlobalEnvRestart(ctx, apps.filter(app => config.apps[app]))
  }
  // The top-level blocks are Dokku's own `--global` settings. A block the file does not
  // declare is never read, so settings made outside the file stay (even under --prune).
  const globalOpts = { prune: opts.prune, apps: apps.filter(app => config.apps[app]), appConfigs: config.apps }
  for (const name of GLOBAL_UP_ORDER) {
    if (config[name] !== undefined) await ensureGlobal(ctx, name, config[name], globalOpts)
  }

  // Phase 3: Networks
  if (config.networks) await ensureNetworks(ctx, config.networks)

  // Storage entries, before any app mounts one. An entry that fails is logged
  // and the run goes on; the apps that mount it report it themselves.
  const failedVolumes = config.volumes ? await ensureVolumes(ctx, config.volumes, opts.failFast) : new Map<string, string>()

  // Phase 4: Services
  const createdPostgres = config.postgres ? await ensurePostgres(ctx, config.postgres) : new Set<string>()
  const createdRedis = config.redis ? await ensureRedis(ctx, config.redis) : new Set<string>()
  if (config.postgres) {
    await ensureServiceBackups(ctx, 'postgres', config.postgres, {
      prune: opts.prune,
      dryRun: opts.dryRun,
      dryRunCreated: opts.dryRun ? createdPostgres : undefined,
    })
  }
  if (config.redis) {
    await ensureServiceBackups(ctx, 'redis', config.redis, {
      prune: opts.prune,
      dryRun: opts.dryRun,
      dryRunCreated: opts.dryRun ? createdRedis : undefined,
    })
  }
  await removeBackupHashKeys(ctx)

  // Phase 5: Per-app. Default (documented) behaviour is to continue to the
  // next app on failure and report a summary at the end, exiting non-zero.
  // --fail-fast stops at the first failure instead.
  const failures: { app: string; error: unknown }[] = []
  for (const app of apps) {
    const appConfig = config.apps[app]
    if (!appConfig) continue

    try {
      await processApp(ctx, config, app, appConfig, opts.failFast, opts.prune, failedVolumes)
    } catch (error) {
      if (opts.failFast) throw error
      // Failures from individual steps were already logged by processApp.
      if (!(error instanceof AppStepsError)) {
        logError(app, error instanceof Error ? error.message : String(error))
      }
      failures.push({ app, error })
    }
  }

  if (failures.length > 0) {
    throw new UpFailedError(failures)
  }
  // An entry that failed and that no processed app reported (it is already logged).
  if (failedVolumes.size > 0) {
    throw new Error(`up failed for storage entr${failedVolumes.size === 1 ? 'y' : 'ies'}: ${[...failedVolumes.keys()].join(', ')}`)
  }
}
