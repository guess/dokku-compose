import type { Runner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import type { Config } from '../core/schema.js'
import { exportApps } from '../modules/apps.js'
import { exportAppDomains } from '../modules/domains.js'
import { exportAppConfig } from '../modules/config.js'
import { exportAppPorts } from '../modules/ports.js'
import { exportAppProxy } from '../modules/proxy.js'
import { exportAppCerts } from '../modules/certs.js'
import { exportAppStorage } from '../modules/storage.js'
import { exportAppNginx } from '../modules/nginx.js'
import { exportAppChecks } from '../modules/checks.js'
import { exportAppLogs } from '../modules/logs.js'
import { exportAppRegistry } from '../modules/registry.js'
import { exportAppScheduler } from '../modules/scheduler.js'
import { exportNetworks, exportAppNetwork } from '../modules/network.js'
import { exportServices, exportAppLinks } from '../modules/services.js'

export interface ExportOptions {
  appFilter?: string[]
}

export async function runExport(runner: Runner, opts: ExportOptions): Promise<Config> {
  const ctx = createContext(runner)
  const config: Config = { apps: {} }

  // Dokku version
  const versionOutput = await ctx.query('version')
  const versionMatch = versionOutput.match(/(\d+\.\d+\.\d+)/)
  if (versionMatch) config.dokku = { version: versionMatch[1] }

  // Apps
  const apps = opts.appFilter?.length ? opts.appFilter : await exportApps(ctx)

  // Networks
  const networks = await exportNetworks(ctx)
  if (networks.length > 0) config.networks = networks

  // Services
  const services = await exportServices(ctx)
  if (Object.keys(services).length > 0) config.services = services

  // Per-app
  for (const app of apps) {
    const appConfig: Config['apps'][string] = {}

    const domains = await exportAppDomains(ctx, app)
    if (domains !== undefined) appConfig.domains = domains

    const links = await exportAppLinks(ctx, app, services)
    if (links.length > 0) appConfig.links = links

    const ports = await exportAppPorts(runner, app)
    if (ports?.length) appConfig.ports = ports

    const proxy = await exportAppProxy(runner, app)
    if (proxy !== undefined) appConfig.proxy = proxy

    const ssl = await exportAppCerts(runner, app)
    if (ssl !== undefined) appConfig.ssl = ssl

    const storage = await exportAppStorage(runner, app)
    if (storage?.length) appConfig.storage = storage

    const nginx = await exportAppNginx(ctx, app)
    if (nginx && Object.keys(nginx).length) appConfig.nginx = nginx

    const checks = await exportAppChecks(runner, app)
    if (checks !== undefined) appConfig.checks = checks

    const logs = await exportAppLogs(ctx, app)
    if (logs && Object.keys(logs).length) appConfig.logs = logs

    const registry = await exportAppRegistry(runner, app)
    if (registry && Object.keys(registry).length) appConfig.registry = registry

    const scheduler = await exportAppScheduler(runner, app)
    if (scheduler) appConfig.scheduler = scheduler

    const networkCfg = await exportAppNetwork(ctx, app)
    if (networkCfg?.networks?.length) appConfig.networks = networkCfg.networks
    if (networkCfg?.network) appConfig.network = networkCfg.network

    const env = await exportAppConfig(ctx, app)
    if (env && Object.keys(env).length) appConfig.env = env

    config.apps[app] = appConfig
  }

  return config
}
