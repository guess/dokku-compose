import type { Context } from '../core/context.js'
import type { Config } from '../core/schema.js'
import { reconcile } from '../core/reconcile.js'
import { Apps } from '../resources/lifecycle.js'
import { Domains, Ports, Storage } from '../resources/lists.js'
import { Nginx, Logs, Registry, Scheduler } from '../resources/properties.js'
import { Proxy } from '../resources/toggle.js'
import { Config as ConfigResource } from '../resources/config.js'
import { Certs } from '../resources/certs.js'
import { Builder } from '../resources/builder.js'
import { DockerOptions } from '../resources/docker-options.js'
import { Git } from '../resources/git.js'
import { Checks } from '../resources/checks.js'
import { Networks, NetworkProps } from '../resources/network.js'
import { ensurePlugins } from '../modules/plugins.js'
import { ensureDockerAuth } from '../modules/docker-auth.js'
import { ensureNetworks } from '../modules/network.js'
import { ensurePostgres, ensurePostgresBackups } from '../modules/postgres.js'
import { ensureRedis } from '../modules/redis.js'
import { ensureDokkuVersion } from '../modules/version.js'
import { ensureAppLinks } from '../modules/links.js'
import { ensureGlobalDomains } from '../modules/domains.js'
import { ensureGlobalConfig } from '../modules/config.js'
import { ensureGlobalLogs } from '../modules/logs.js'
import { ensureGlobalNginx } from '../modules/nginx.js'
import { logError } from '../core/logger.js'
import type { AppConfig } from '../core/schema.js'

export interface RunUpOptions {
  /** Stop at the first per-app failure instead of continuing to the next app. */
  failFast?: boolean
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

async function processApp(
  ctx: Context, config: Config, app: string, appConfig: AppConfig, failFast = false
): Promise<void> {
  // A resource that throws is recorded and the rest of the app still runs,
  // so one broken resource cannot hide another (e.g. env never being reached).
  const errors: unknown[] = []
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
  await step(() => reconcile(Apps, ctx, app, true))

  // Networking
  await step(() => reconcile(Domains, ctx, app, appConfig.domains))
  await step(() => reconcile(Networks, ctx, app, appConfig.networks))
  await step(() => reconcile(NetworkProps, ctx, app, appConfig.network))
  await step(() => reconcile(Proxy, ctx, app, appConfig.proxy?.enabled))
  await step(() => reconcile(Ports, ctx, app, appConfig.ports))

  // Links (between networking and config)
  if (config.postgres || config.redis) {
    await step(() => ensureAppLinks(ctx, app, appConfig.links ?? [], config))
  }

  // Configuration
  await step(() => reconcile(Certs, ctx, app, appConfig.ssl))
  await step(() => reconcile(Storage, ctx, app, appConfig.storage))
  await step(() => reconcile(Nginx, ctx, app, appConfig.nginx))
  await step(() => reconcile(Checks, ctx, app, appConfig.checks))
  await step(() => reconcile(Logs, ctx, app, appConfig.logs))
  await step(() => reconcile(Registry, ctx, app, appConfig.registry))
  await step(() => reconcile(Scheduler, ctx, app, appConfig.scheduler))
  await step(() => reconcile(ConfigResource, ctx, app, appConfig.env || {}))

  // Build
  await step(() => reconcile(Builder, ctx, app, appConfig.build))
  await step(() => reconcile(Git, ctx, app, appConfig.git ?? config.git))
  await step(() => reconcile(DockerOptions, ctx, app, appConfig.docker_options))

  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) {
    throw new AggregateError(errors, errors.map(e => e instanceof Error ? e.message : String(e)).join('; '))
  }
}

export async function runUp(
  ctx: Context,
  config: Config,
  appFilter: string[],
  opts: RunUpOptions = {}
): Promise<void> {
  const apps = appFilter.length > 0
    ? appFilter
    : Object.keys(config.apps)

  // Global phases: every app depends on these, so a failure here aborts the
  // whole run immediately, regardless of --fail-fast.

  // Phase 0: Version check
  await ensureDokkuVersion(ctx, config.dokku?.version)

  // Phase 1: Plugins & host-level auth
  if (config.plugins) await ensurePlugins(ctx, config.plugins)
  if (config.docker_auth) await ensureDockerAuth(ctx, config.docker_auth)

  // Phase 2: Global config
  if (config.domains !== undefined) await ensureGlobalDomains(ctx, config.domains)
  if (config.env !== undefined) await ensureGlobalConfig(ctx, config.env)
  if (config.logs !== undefined) await ensureGlobalLogs(ctx, config.logs)
  if (config.nginx !== undefined) await ensureGlobalNginx(ctx, config.nginx)

  // Phase 3: Networks
  if (config.networks) await ensureNetworks(ctx, config.networks)

  // Phase 4: Services
  if (config.postgres) await ensurePostgres(ctx, config.postgres)
  if (config.redis) await ensureRedis(ctx, config.redis)
  if (config.postgres) await ensurePostgresBackups(ctx, config.postgres)

  // Phase 5: Per-app. Default (documented) behaviour is to continue to the
  // next app on failure and report a summary at the end, exiting non-zero.
  // --fail-fast stops at the first failure instead.
  const failures: { app: string; error: unknown }[] = []
  for (const app of apps) {
    const appConfig = config.apps[app]
    if (!appConfig) continue

    try {
      await processApp(ctx, config, app, appConfig, opts.failFast)
    } catch (error) {
      if (opts.failFast) throw error
      const message = error instanceof Error ? error.message : String(error)
      logError(app, message)
      failures.push({ app, error })
    }
  }

  if (failures.length > 0) {
    throw new UpFailedError(failures)
  }
}
