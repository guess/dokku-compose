import type { Runner } from '../core/dokku.js'
import type { Config } from '../core/schema.js'
import { ensureApp } from '../modules/apps.js'
import { ensureAppDomains, ensureGlobalDomains } from '../modules/domains.js'
import { ensurePlugins } from '../modules/plugins.js'
import { ensureNetworks, ensureAppNetworks, ensureAppNetwork } from '../modules/network.js'
import { ensureServices, ensureAppLinks } from '../modules/services.js'
import { ensureAppProxy } from '../modules/proxy.js'
import { ensureAppPorts } from '../modules/ports.js'
import { ensureAppCerts } from '../modules/certs.js'
import { ensureAppStorage } from '../modules/storage.js'
import { ensureAppNginx, ensureGlobalNginx } from '../modules/nginx.js'
import { ensureAppChecks } from '../modules/checks.js'
import { ensureAppLogs, ensureGlobalLogs } from '../modules/logs.js'
import { ensureAppRegistry } from '../modules/registry.js'
import { ensureAppScheduler } from '../modules/scheduler.js'
import { ensureAppConfig, ensureGlobalConfig } from '../modules/config.js'
import { ensureAppBuilder } from '../modules/builder.js'
import { ensureAppDockerOptions } from '../modules/docker-options.js'

export async function runUp(
  runner: Runner,
  config: Config,
  appFilter: string[]
): Promise<void> {
  const apps = appFilter.length > 0
    ? appFilter
    : Object.keys(config.apps)

  // Phase 1: Plugins
  if (config.plugins) await ensurePlugins(runner, config.plugins)

  // Phase 2: Global config
  if (config.domains !== undefined) await ensureGlobalDomains(runner, config.domains)
  if (config.env !== undefined) await ensureGlobalConfig(runner, config.env)
  if (config.logs !== undefined) await ensureGlobalLogs(runner, config.logs)
  if (config.nginx !== undefined) await ensureGlobalNginx(runner, config.nginx)

  // Phase 3: Networks
  if (config.networks) await ensureNetworks(runner, config.networks)

  // Phase 4: Services
  if (config.services) await ensureServices(runner, config.services)

  // Phase 5: Per-app
  for (const app of apps) {
    const appConfig = config.apps[app]
    if (!appConfig) continue
    await ensureApp(runner, app)
    await ensureAppDomains(runner, app, appConfig.domains)
    if (config.services) await ensureAppLinks(runner, app, appConfig.links ?? [], config.services)
    await ensureAppNetworks(runner, app, appConfig.networks)
    await ensureAppNetwork(runner, app, appConfig.network)
    if (appConfig.proxy) await ensureAppProxy(runner, app, appConfig.proxy.enabled)
    if (appConfig.ports) await ensureAppPorts(runner, app, appConfig.ports)
    if (appConfig.ssl !== undefined) await ensureAppCerts(runner, app, appConfig.ssl)
    if (appConfig.storage) await ensureAppStorage(runner, app, appConfig.storage)
    if (appConfig.nginx) await ensureAppNginx(runner, app, appConfig.nginx)
    if (appConfig.checks !== undefined) await ensureAppChecks(runner, app, appConfig.checks)
    if (appConfig.logs) await ensureAppLogs(runner, app, appConfig.logs)
    if (appConfig.registry) await ensureAppRegistry(runner, app, appConfig.registry)
    if (appConfig.scheduler) await ensureAppScheduler(runner, app, appConfig.scheduler)
    if (appConfig.env !== undefined) await ensureAppConfig(runner, app, appConfig.env)
    if (appConfig.build) await ensureAppBuilder(runner, app, appConfig.build)
    if (appConfig.docker_options) await ensureAppDockerOptions(runner, app, appConfig.docker_options)
  }
}
