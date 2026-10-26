import type { Context } from '../core/context.js'
import type { Config } from '../core/schema.js'
import { ALL_APP_RESOURCES } from '../resources/index.js'
import { exportApps } from '../modules/apps.js'
import { exportPostgres } from '../modules/postgres.js'
import { exportRedis } from '../modules/redis.js'
import { exportAppLinks } from '../modules/links.js'
import { exportNetworks } from '../modules/network.js'
import { GLOBAL_NAMES, exportGlobal } from '../modules/global.js'
import { readEntries, exportVolumes, legacyExportNames, DOCKER_LOCAL, type ServerEntry } from '../modules/volumes.js'
import { parseSpec } from '../resources/storage.js'
import { DEFAULT_SCOPE, ALL_PHASES, defaultPath, isLegacyName, pathError, type MountItem, type ServiceMountItem } from '../core/volume-rules.js'
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
  const serviceMounts = new Map<string, { plugin: 'postgres' | 'redis'; specs: string[] }>()
  const specsOf = new Map<string, string[]>()
  const postgres = await exportPostgres(ctx, specsOf)
  for (const [name, specs] of specsOf) serviceMounts.set(name, { plugin: 'postgres', specs })
  specsOf.clear()
  if (Object.keys(postgres).length > 0) config.postgres = postgres
  const redis = await exportRedis(ctx, specsOf)
  for (const [name, specs] of specsOf) serviceMounts.set(name, { plugin: 'redis', specs })
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

  await exportStorage(ctx, config, mounts, !!opts.appFilter?.length, serviceMounts)

  return config
}

/** `volumes:` and each app's `storage:`, from the entries and mounts on the server. */
async function exportStorage(
  ctx: Context, config: Config, mounts: Map<string, string[]>, onlyMounted: boolean,
  serviceMounts: Map<string, { plugin: 'postgres' | 'redis'; specs: string[] }>,
): Promise<void> {
  let server
  try {
    server = await readEntries(ctx)
  } catch (err) {
    logWarn('storage', `could not read the storage entries, storage left out of the export: ${err instanceof Error ? err.message : String(err)}`)
    for (const name of serviceMounts.keys()) logWarn(name, 'its mounts are left out of the export: the storage entries could not be read')
    return
  }
  const parsed = new Map([...mounts].map(([app, specs]) => [app, specs.map(parseSpec)]))
  const mounted = new Set([...parsed.values()].flat().map(m => m.entry))
  // A service mount names a host path: the entry at that path (the named one before a legacy one) is the entry it mounts.
  const byPath = new Map<string, string>()
  for (const e of [...server.values()].filter(e => e.scheduler === DOCKER_LOCAL && e.host_path).sort((a, b) => Number(isLegacyName(a.name)) - Number(isLegacyName(b.name)) || a.name.localeCompare(b.name))) {
    if (!byPath.has(e.host_path!)) byPath.set(e.host_path!, e.name)
  }
  const serviceSpecs = new Map([...serviceMounts].map(([name, { specs }]) => [name, specs.map(parseServiceSpec)]))
  for (const list of serviceSpecs.values()) for (const m of list) { const entry = byPath.get(m.source); if (entry) mounted.add(entry) }
  const { volumes, names } = exportVolumes(server, mounted, onlyMounted)
  exportServiceMounts(config, serviceMounts, serviceSpecs, byPath, names, volumes, server)
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

interface ServiceSpec { source: string; dir: string; readonly: boolean; options: string[]; dropped: string[] }

/** `<host-path>:<container-dir>[:<options>]` as `<plugin>:info` reports a mount. */
function parseServiceSpec(spec: string): ServiceSpec {
  const [source = '', dir = '', ...rest] = spec.split(':')
  const out: ServiceSpec = { source, dir, readonly: false, options: [], dropped: [] }
  for (const token of rest.join(':').split(',').filter(Boolean)) {
    if (token === 'ro') out.readonly = true
    else if (token.startsWith('volume-subpath=') || token.startsWith('volume-chown=')) out.dropped.push(token.split('=')[0])
    else out.options.push(token)
  }
  return out
}

/**
 * Each service's `mounts:`: the `volumes:` entry at the mount's host path, else a new entry named after
 * the directory (added to `volumes`, with `path:`). A mount that cannot be an entry is left out with a warning.
 */
function exportServiceMounts(
  config: Config,
  serviceMounts: Map<string, { plugin: 'postgres' | 'redis'; specs: string[] }>,
  parsed: Map<string, ServiceSpec[]>,
  byPath: Map<string, string>,
  names: Map<string, string>,
  volumes: NonNullable<Config['volumes']>,
  server: Map<string, ServerEntry>,
): void {
  const taken = new Set([...server.keys(), ...Object.keys(volumes)])
  const added = new Map<string, string>()
  for (const [svc, { plugin }] of serviceMounts) {
    const items: (string | ServiceMountItem)[] = []
    for (const m of parsed.get(svc) ?? []) {
      let entry = byPath.has(m.source) ? names.get(byPath.get(m.source)!) : added.get(m.source)
      if (entry === undefined && !byPath.has(m.source)) {
        const given = pathError(m.source) === undefined
          ? legacyExportNames([{ name: m.source, scheduler: DOCKER_LOCAL, host_path: m.source }], taken).get(m.source) ?? null
          : null
        if (given === null) {
          logWarn(svc, `mount of ${m.source} at ${m.dir} left out of the export: no valid volumes: entry can name it`)
          continue
        }
        volumes[given] = m.source === defaultPath(given) ? { chown: false } : { path: m.source }
        added.set(m.source, given)
        entry = given
      }
      if (entry === undefined) { logWarn(svc, `mount of ${m.source} at ${m.dir} left out of the export: dokku-compose manages only docker-local entries`); continue }
      if (m.dropped.length > 0) logWarn(svc, `${m.dir}: ${m.dropped.join(' and ')} dropped: not managed for a service mount`)
      items.push(!m.readonly && m.options.length === 0
        ? `${entry}:${m.dir}`
        : { entry, container_dir: m.dir, ...(m.readonly ? { readonly: true } : {}), ...(m.options.length > 0 ? { options: m.options } : {}) })
    }
    if (items.length > 0) (config[plugin] as Record<string, { mounts?: (string | ServiceMountItem)[] }>)[svc].mounts = items
  }
}
