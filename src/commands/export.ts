import type { Context } from '../core/context.js'
import type { Config } from '../core/schema.js'
import { ALL_APP_RESOURCES } from '../resources/index.js'
import { exportApps } from '../modules/apps.js'
import { exportServices, exportAppLinks } from '../modules/services.js'
import { exportNetworks } from '../modules/network.js'

export interface ExportOptions {
  appFilter?: string[]
}

export async function runExport(ctx: Context, opts: ExportOptions): Promise<Config> {
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

    // Read each resource and populate if non-empty
    for (const resource of ALL_APP_RESOURCES) {
      if (resource.key.startsWith('_')) continue  // skip internal keys like _app
      if (resource.forceApply) continue  // skip forceApply resources — they can't be read

      const value = await resource.read(ctx, app)

      // Skip empty values
      if (value === undefined || value === null || value === '') continue
      if (Array.isArray(value) && value.length === 0) continue
      if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0) continue

      // Handle schema mapping: Proxy resource reads boolean, schema wants { enabled: boolean }
      if (resource.key === 'proxy') {
        (appConfig as any).proxy = { enabled: value as boolean }
      } else {
        (appConfig as any)[resource.key] = value
      }
    }

    // Links (custom read — not a resource)
    if (Object.keys(services).length > 0) {
      const links = await exportAppLinks(ctx, app, services)
      if (links.length > 0) appConfig.links = links
    }

    config.apps[app] = appConfig
  }

  return config
}
