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
import { ensureNetworks } from '../modules/network.js'
import { ensureServices, ensureServiceBackups, ensureAppLinks } from '../modules/services.js'
import { ensureGlobalDomains } from '../modules/domains.js'
import { ensureGlobalConfig } from '../modules/config.js'
import { ensureGlobalLogs } from '../modules/logs.js'
import { ensureGlobalNginx } from '../modules/nginx.js'

export async function runUp(
  ctx: Context,
  config: Config,
  appFilter: string[]
): Promise<void> {
  const apps = appFilter.length > 0
    ? appFilter
    : Object.keys(config.apps)

  // Phase 1: Plugins
  if (config.plugins) await ensurePlugins(ctx, config.plugins)

  // Phase 2: Global config
  if (config.domains !== undefined) await ensureGlobalDomains(ctx, config.domains)
  if (config.env !== undefined) await ensureGlobalConfig(ctx, config.env)
  if (config.logs !== undefined) await ensureGlobalLogs(ctx, config.logs)
  if (config.nginx !== undefined) await ensureGlobalNginx(ctx, config.nginx)

  // Phase 3: Networks
  if (config.networks) await ensureNetworks(ctx, config.networks)

  // Phase 4: Services
  if (config.services) await ensureServices(ctx, config.services)
  if (config.services) await ensureServiceBackups(ctx, config.services)

  // Phase 5: Per-app
  for (const app of apps) {
    const appConfig = config.apps[app]
    if (!appConfig) continue

    // Lifecycle
    await reconcile(Apps, ctx, app, true)

    // Networking
    await reconcile(Domains, ctx, app, appConfig.domains)
    await reconcile(Networks, ctx, app, appConfig.networks)
    await reconcile(NetworkProps, ctx, app, appConfig.network)
    await reconcile(Proxy, ctx, app, appConfig.proxy?.enabled)
    await reconcile(Ports, ctx, app, appConfig.ports)

    // Links (between networking and config)
    if (config.services) {
      await ensureAppLinks(ctx, app, appConfig.links ?? [], config.services)
    }

    // Configuration
    await reconcile(Certs, ctx, app, appConfig.ssl)
    await reconcile(Storage, ctx, app, appConfig.storage)
    await reconcile(Nginx, ctx, app, appConfig.nginx)
    await reconcile(Checks, ctx, app, appConfig.checks)
    await reconcile(Logs, ctx, app, appConfig.logs)
    await reconcile(Registry, ctx, app, appConfig.registry)
    await reconcile(Scheduler, ctx, app, appConfig.scheduler)
    await reconcile(ConfigResource, ctx, app, appConfig.env)

    // Build
    await reconcile(Builder, ctx, app, appConfig.build)
    await reconcile(Git, ctx, app, appConfig.git ?? config.git)
    await reconcile(DockerOptions, ctx, app, appConfig.docker_options)
  }
}
