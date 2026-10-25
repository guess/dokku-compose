import type { Context } from '../core/context.js'
import type { Config } from '../core/schema.js'
import { ALL_APP_RESOURCES } from '../resources/index.js'
import { exportApps } from '../modules/apps.js'
import { exportPostgres } from '../modules/postgres.js'
import { exportRedis } from '../modules/redis.js'
import { exportAppLinks } from '../modules/links.js'
import { exportNetworks } from '../modules/network.js'
import { GLOBAL_NAMES, exportGlobal } from '../modules/global.js'
import { readEntries, exportVolumes } from '../modules/volumes.js'
import { parseSpec } from '../resources/storage.js'
import { DEFAULT_SCOPE, ALL_PHASES, type MountItem } from '../core/volume-rules.js'
import { logWarn } from '../core/logger.js'
import { assertDokkuSupported } from '../modules/version.js'

export interface ExportOptions {
  appFilter?: string[]
}

export async function runExport(ctx: Context, opts: ExportOptions): Promise<Config> {
  const config: Config = { apps: {} }

  config.dokku = { version: await assertDokkuSupported(ctx) }

  // Apps
  const apps = opts.appFilter?.length ? opts.appFilter : await exportApps(ctx)

  // Networks
  const networks = await exportNetworks(ctx)
  if (networks.length > 0) config.networks = networks

  // Global settings: each top-level block that holds a value on the server
  for (const name of GLOBAL_NAMES) {
    try {
      const block = await exportGlobal(ctx, name)
      if (block !== undefined) (config as Record<string, unknown>)[name] = block
    } catch (err) {
      logWarn('global', `could not read '${name}', left out of the export: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Services
  const postgres = await exportPostgres(ctx)
  if (Object.keys(postgres).length > 0) config.postgres = postgres
  const redis = await exportRedis(ctx)
  if (Object.keys(redis).length > 0) config.redis = redis

  // Bulk prefetch: run all readAll queries in parallel
  const prefetched = new Map<string, Map<string, unknown>>()
  await Promise.all(
    ALL_APP_RESOURCES
      .filter(r => !r.forceApply && !r.key.startsWith('_') && r.readAll)
      .map(async r => {
        // A bulk read that fails falls back to the per-app read below.
        try { prefetched.set(r.key, await r.readAll!(ctx)) } catch { /* per-app fallback */ }
      })
  )

  // Per-app
  const mounts = new Map<string, string[]>()
  for (const app of apps) {
    const appConfig: Config['apps'][string] = {}

    // Read each resource and populate if non-empty
    for (const resource of ALL_APP_RESOURCES) {
      if (resource.key.startsWith('_')) continue  // skip internal keys like _app
      if (resource.forceApply) continue  // skip forceApply resources — they can't be read
      // The checks report holds comma-joined lists the schema does not take as is.
      if (resource.key === 'checks') continue

      // Mounts are written once the entries are known: legacy entries get new names.
      if (resource.key === 'storage') {
        try { mounts.set(app, await resource.read(ctx, app) as string[]) } catch (err) {
          logWarn(app, `could not read 'storage', left out of the export: ${err instanceof Error ? err.message : String(err)}`)
        }
        continue
      }

      const bulk = prefetched.get(resource.key)
      let value: unknown
      try {
        value = bulk ? bulk.get(app) : await resource.read(ctx, app)
      } catch (err) {
        logWarn(app, `could not read '${resource.key}', left out of the export: ${err instanceof Error ? err.message : String(err)}`)
        continue
      }

      // Skip empty values
      if (value === undefined || value === null || value === '') continue
      if (Array.isArray(value) && value.length === 0) continue
      if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0) continue

      // Handle schema mapping: Proxy resource reads boolean, schema wants { enabled: boolean }
      if (resource.key === 'ssl') {
        // An installed cert exports as `true`: the file paths are not on the server.
        (appConfig as any).ssl = value !== false
      } else if (resource.key === 'proxy') {
        (appConfig as any).proxy = { ...(appConfig as any).proxy, enabled: value as boolean }
      } else if (resource.key === 'proxy_props') {
        (appConfig as any).proxy = { ...(appConfig as any).proxy, ...(value as object) }
      } else {
        (appConfig as any)[resource.key] = value
      }
    }

    // Links (custom read — not a resource)
    if (config.postgres || config.redis) {
      const links = await exportAppLinks(ctx, app, config)
      if (links.length > 0) appConfig.links = links
    }

    config.apps[app] = appConfig
  }

  await exportStorage(ctx, config, mounts, !!opts.appFilter?.length)

  return config
}

/** `volumes:` and each app's `storage:`, from the entries and mounts on the server. */
async function exportStorage(ctx: Context, config: Config, mounts: Map<string, string[]>, onlyMounted: boolean): Promise<void> {
  let server
  try {
    server = await readEntries(ctx)
  } catch (err) {
    logWarn('storage', `could not read the storage entries, storage left out of the export: ${err instanceof Error ? err.message : String(err)}`)
    return
  }
  const parsed = new Map([...mounts].map(([app, specs]) => [app, specs.map(parseSpec)]))
  const mounted = new Set([...parsed.values()].flat().map(m => m.entry))
  const { volumes, names } = exportVolumes(server, mounted, onlyMounted)
  if (Object.keys(volumes).length > 0) config.volumes = volumes

  for (const [app, list] of parsed) {
    const items: (string | MountItem)[] = []
    for (const m of list) {
      const entry = names.get(m.entry)
      if (entry === undefined) {
        // An entry of another scheduler (or one that vanished): nothing the file can name.
        logWarn(app, `mount of '${m.entry}' at ${m.dir} left out of the export: dokku-compose manages only docker-local entries`)
        continue
      }
      if (m.subpath || m.volumeChown) {
        logWarn(app, `${m.dir}: ${[m.subpath && 'volume-subpath', m.volumeChown && 'volume-chown'].filter(Boolean).join(' and ')} dropped: docker-local stores it but never applies it`)
      }
      const plain = !m.readonly && m.phases.length === ALL_PHASES.length && m.options.length === 0 && m.scope === DEFAULT_SCOPE
      if (plain) { items.push(`${entry}:${m.dir}`); continue }
      items.push({
        entry,
        container_dir: m.dir,
        ...(m.readonly ? { readonly: true } : {}),
        ...(m.phases.length !== ALL_PHASES.length ? { phases: m.phases } : {}),
        ...(m.scope !== DEFAULT_SCOPE ? { process_type: m.scope } : {}),
        ...(m.options.length > 0 ? { options: m.options } : {}),
      })
    }
    if (items.length > 0) config.apps[app].storage = items
  }
}
