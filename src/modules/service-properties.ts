import { createHash } from 'crypto'
import type { Context } from '../core/context.js'
import { EXPORT_PLACEHOLDER, type Config, type ServicePropertiesConfig } from '../core/schema.js'
import { logAction, logDone, logError, logSkip } from '../core/logger.js'
import { normalizeLink } from './links.js'
import { forgetServiceInfo, readServiceInfo, field, type ServiceInfo, type ServiceMismatch } from './service-drift.js'
import {
  MANAGED_PROPERTIES, PRUNABLE_PROPERTIES, propertyString, targetPairs, sameProperty, isDefaultProperty, mountSet, parseInfoMounts,
  type ServicePlugin,
} from './service-property-keys.js'

/** The parts of a postgres or redis service these functions read. */
export interface ServicePropertiesInput {
  properties?: ServicePropertiesConfig
  mounts?: string[]
}

/**
 * The `<plugin>:create` flags for a new service's declared `properties` and `mounts`: every
 * managed key is a create flag, so a new service is made with them and needs no restart.
 * Keys with no built-in entry are set after the service exists.
 */
export function createArgs(declared: ServicePropertiesInput): string[] {
  const args: string[] = []
  for (const [key, value] of declaredEntries(declared.properties)) {
    const spec = MANAGED_PROPERTIES[key]
    if (!spec) continue
    // volume-targets: one --volume-target <volume>=<path> per entry
    if (spec.repeat) for (const pair of value.split(' ')) args.push(`--${spec.createFlag}`, pair)
    else args.push(`--${spec.createFlag}`, value)
  }
  for (const mount of declared.mounts ?? []) args.push('--volume', mount)
  return args
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex')

/** What one declared or pruned key needs. */
interface PropertyChange {
  key: string
  /** `<plugin>:set` arguments after the service name, e.g. `['--', value]` or `[]` to clear */
  value?: string
  /** `--no-restart` goes before the service name (the password) */
  noRestart?: boolean
  restart: boolean
  password: boolean
}

function declaredEntries(properties: ServicePropertiesConfig | undefined): [string, string][] {
  return Object.entries(properties ?? {}).map(([key, value]) => [key, propertyString(key, value)])
}

/** Changes that make the server's properties match the file; with `prune`, also clear known keys it dropped. */
export function propertyChanges(plugin: ServicePlugin, info: ServiceInfo, properties: ServicePropertiesConfig | undefined, prune: boolean): PropertyChange[] {
  const changes: PropertyChange[] = []
  const declared = new Set<string>()
  for (const [key, desired] of declaredEntries(properties)) {
    declared.add(key)
    const spec = MANAGED_PROPERTIES[key]
    if (spec?.kind === 'secret') {
      if (!(`${key}-fingerprint` in info)) throw new Error(`dokku-${plugin} too old to report the ${key} fingerprint`)
      if (field(info, `${key}-fingerprint`) !== sha256(desired)) {
        changes.push({ key, value: desired, noRestart: true, restart: false, password: true })
      }
      continue
    }
    if (!sameProperty(key, desired, field(info, key))) {
      changes.push({ key, value: desired, restart: spec?.restart ?? false, password: false })
    }
  }
  if (prune) {
    for (const key of PRUNABLE_PROPERTIES) {
      if (declared.has(key) || isDefaultProperty(key, field(info, key))) continue
      changes.push({ key, restart: MANAGED_PROPERTIES[key].restart, password: false })
    }
  }
  return changes
}

/** The mounts the server reports, as normalised specs. A plugin that reports none of the key is too old to compare. */
function serverMounts(plugin: ServicePlugin, info: ServiceInfo): string[] {
  if (!('mounts' in info)) throw new Error(`dokku-${plugin} too old to report mounts`)
  return parseInfoMounts(field(info, 'mounts'))
}

/**
 * The command that makes the server's mounts equal the declared set (order and `rw` do not
 * matter): `:mount --replace` with the whole list, or `:unmount --all` for `mounts: []`.
 * Nothing when the file declares no `mounts:` or the sets are equal.
 */
export function mountCommand(plugin: ServicePlugin, name: string, info: ServiceInfo, mounts: string[] | undefined): string[] | undefined {
  if (mounts === undefined) return undefined
  const desired = mountSet(mounts)
  const current = serverMounts(plugin, info)
  if (desired.join(' ') === current.join(' ')) return undefined
  if (desired.length === 0) return [`${plugin}:unmount`, '--all', name]
  return [`${plugin}:mount`, '--replace', name, ...new Set(mounts)]
}

/** Drift of the declared `mounts` against the server, for `diff`. */
export function mountMismatches(plugin: ServicePlugin, info: ServiceInfo, mounts: string[] | undefined): ServiceMismatch[] {
  if (mounts === undefined) return []
  const desired = mountSet(mounts)
  const current = serverMounts(plugin, info)
  return desired.join(' ') === current.join(' ') ? [] : [{ field: 'mounts', desired: desired.join(' ') || '(none)', current: current.join(' ') || '(none)' }]
}

/**
 * The apps linked to a service, from `<plugin>:links <svc>`. A dry run adds the apps whose
 * `links:` name the service, which a service planned for creation has not linked yet.
 */
export async function linkedApps(ctx: Context, plugin: ServicePlugin, name: string, config: Config, dryRun = false): Promise<string[]> {
  const apps = new Set((await ctx.query(`${plugin}:links`, name)).split('\n').map(l => l.trim()).filter(l => /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(l)))
  if (dryRun) {
    for (const [app, appConfig] of Object.entries(config.apps)) {
      if ((appConfig.links ?? []).some(l => normalizeLink(l).service === name)) apps.add(app)
    }
  }
  return [...apps]
}

/** The `<plugin>:set` argv for a change. */
function setArgs(plugin: ServicePlugin, name: string, change: PropertyChange): string[] {
  return [
    `${plugin}:set`, ...(change.noRestart ? ['--no-restart'] : []), name, change.key,
    ...(change.value === undefined ? [] : ['--', change.value]),
  ]
}

/**
 * Converge each service's `properties:` with what `<plugin>:info --format json` reports.
 * A key that differs is set with `<plugin>:set <svc> <key> -- <value>`; a key that needs
 * stop and start adds the service to the restart summary (nothing is restarted). A service
 * whose step fails is reported and returned; the others still run.
 * `dryRunCreated` names services this --dry-run only planned to create: every managed key
 * is a `:create` flag, so there is nothing more to plan.
 */
export async function ensureServiceProperties(
  ctx: Context,
  plugin: ServicePlugin,
  services: Record<string, ServicePropertiesInput>,
  config: Config,
  opts: { prune?: boolean; dryRun?: boolean; dryRunCreated?: Set<string> } = {},
): Promise<{ service: string; error: unknown }[]> {
  const failures: { service: string; error: unknown }[] = []
  for (const [name, declared] of Object.entries(services)) {
    if (declared.properties === undefined && declared.mounts === undefined && !opts.prune) continue
    if (opts.dryRunCreated?.has(name)) continue
    try {
      const info = await readServiceInfo(ctx, plugin, name)
      const changes = propertyChanges(plugin, info, declared.properties, opts.prune ?? false)
      const mount = mountCommand(plugin, name, info, declared.mounts)
      logAction('services', `Configuring properties for ${name}`)
      if (changes.length === 0 && !mount) { logSkip(); continue }
      for (const change of changes) {
        await ctx.run(...setArgs(plugin, name, change))
        forgetServiceInfo(ctx, plugin, name)
        if (change.restart) ctx.needsServiceRestart(plugin, name, change.key)
        // the plugin rewrites the url every linked app holds: they pick it up when they restart
        if (change.password) for (const app of await linkedApps(ctx, plugin, name, config, opts.dryRun)) ctx.needsRestart(app, `${name} ${change.key} changed`)
      }
      if (mount) {
        await ctx.run(...mount)
        forgetServiceInfo(ctx, plugin, name)
        // mounts are read when the container is made
        ctx.needsServiceRestart(plugin, name, 'mounts')
      }
      logDone()
    } catch (error) {
      console.log('')
      logError(name, error instanceof Error ? error.message : String(error))
      failures.push({ service: name, error })
    }
  }
  return failures
}

/**
 * Drift of the declared `properties` against the server, for `diff`. A declared key that
 * differs is `~`; a managed key the server holds with a non-default value and the file omits
 * is `removed` (`-`). Secrets are compared by fingerprint and never named.
 */
export function propertyMismatches(plugin: ServicePlugin, info: ServiceInfo, properties: ServicePropertiesConfig | undefined): ServiceMismatch[] {
  const out: ServiceMismatch[] = []
  const declared = new Set<string>()
  for (const [key, desired] of declaredEntries(properties)) {
    declared.add(key)
    const spec = MANAGED_PROPERTIES[key]
    if (spec?.kind === 'secret') {
      if (!(`${key}-fingerprint` in info)) throw new Error(`dokku-${plugin} too old to report the ${key} fingerprint`)
      const stored = field(info, `${key}-fingerprint`)
      if (stored !== sha256(desired)) {
        out.push({ field: `properties.${key}`, desired: `the ${key} from the file`, current: stored === '' ? `no ${key}` : `another ${key}` })
      }
      continue
    }
    const current = field(info, key)
    if (!sameProperty(key, desired, current)) out.push({ field: `properties.${key}`, desired, current })
  }
  for (const key of PRUNABLE_PROPERTIES) {
    const current = field(info, key)
    if (declared.has(key) || isDefaultProperty(key, current)) continue
    out.push({ field: `properties.${key}`, desired: '(not in the file)', current, removed: true })
  }
  return out
}

/**
 * The `properties` and `mounts` `export` writes for a service, from `<plugin>:info --format json`:
 * managed keys with a value that is not the plugin's default. `password` is never written (only its
 * fingerprint is readable) and every `custom-env` value is `REPLACE_ME`. A service whose info cannot
 * be read gets neither (the backup export has already said so).
 */
export async function exportServiceProperties(
  ctx: Context,
  plugin: ServicePlugin,
  name: string,
): Promise<{ properties?: ServicePropertiesConfig; mounts?: string[] }> {
  let info: ServiceInfo
  try {
    info = await readServiceInfo(ctx, plugin, name)
  } catch {
    return {}
  }
  const properties: ServicePropertiesConfig = {}
  for (const key of PRUNABLE_PROPERTIES) {
    const current = field(info, key)
    if (isDefaultProperty(key, current)) continue
    switch (MANAGED_PROPERTIES[key].kind) {
      case 'list': properties[key] = current.split(',').filter(v => v !== ''); break
      case 'map': properties[key] = Object.fromEntries(current.split(';').filter(v => v !== '').map(p => [p.split('=')[0], EXPORT_PLACEHOLDER])); break
      case 'number': properties[key] = Number(current); break
      case 'targets': properties[key] = Object.fromEntries(targetPairs(current)); break
      default: properties[key] = current
    }
  }
  const mounts = 'mounts' in info ? parseInfoMounts(field(info, 'mounts')) : []
  return {
    ...(Object.keys(properties).length > 0 ? { properties } : {}),
    ...(mounts.length > 0 ? { mounts } : {}),
  }
}
