import type { Context } from '../core/context.js'
import type { Config, PostgresConfig } from '../core/schema.js'
import { logAction, logDone, logSkip, logWarn } from '../core/logger.js'
import { readServiceMismatches } from './service-drift.js'
import { createArgs, exportServiceProperties } from './service-properties.js'
import { resolveServiceMounts } from './service-mounts.js'
import { exportServiceBackup } from './service-backup.js'
import { readGlobalEnv, BACKUP_HASH_PREFIX } from './config.js'

export async function ensurePostgres(
  ctx: Context,
  services: Record<string, PostgresConfig>,
  volumes?: Config['volumes'],
): Promise<Set<string>> {
  const created = new Set<string>()
  for (const [name, config] of Object.entries(services)) {
    logAction('services', `Ensuring ${name}`)
    const exists = await ctx.check('postgres:exists', name)
    if (exists) {
      logSkip()
      // Changing a service's version or image can need a dump and downtime, so
      // `up` only warns; run `postgres:upgrade` yourself.
      try {
        const mismatches = await readServiceMismatches(ctx, 'postgres', name, config)
        if (mismatches.length > 0) {
          const parts = mismatches.map(m => `${m.field} is ${m.current || '(unknown)'} on the server but ${m.desired} in the file`)
          logWarn('services', `${name}: ${parts.join('; ')}; up does not change it`)
        }
      } catch (err) {
        logWarn('services', `${name}: could not compare version and image: ${err instanceof Error ? err.message : String(err)}`)
      }
      continue
    }
    const args: string[] = ['postgres:create', name]
    if (config.image) args.push('--image', config.image)
    if (config.version) args.push('--image-version', config.version)
    args.push(...createArgs(config, await resolveServiceMounts(ctx, volumes, config.mounts)))
    await ctx.run(...args)
    created.add(name)
    logDone()
  }
  return created
}

/**
 * Unset the global `DOKKU_COMPOSE_BACKUP_HASH_*` keys earlier versions kept
 * (Dokku merges global env into every app). Global unset never restarts apps.
 */
export async function removeBackupHashKeys(ctx: Context): Promise<void> {
  let env: Record<string, string>
  try {
    env = await readGlobalEnv(ctx)
  } catch (err) {
    // With env: declared the global env step has already failed loudly; this cleanup can wait for the next run.
    logWarn('global', `could not read global env to remove old backup hash keys: ${err instanceof Error ? err.message : String(err)}`)
    return
  }
  const stale = staleBackupHashKeys(env)
  if (stale.length === 0) return
  logAction('global', `Removing ${stale.length} old backup hash key(s)`)
  await ctx.run('config:unset', '--global', '--no-restart', ...stale)
  logDone()
}

export function staleBackupHashKeys(env: Record<string, string>): string[] {
  return Object.keys(env).filter(k => k.startsWith(BACKUP_HASH_PREFIX)).sort()
}

export async function destroyPostgres(
  ctx: Context,
  services: Record<string, PostgresConfig>
): Promise<void> {
  for (const [name] of Object.entries(services)) {
    logAction('services', `Destroying ${name}`)
    const exists = await ctx.check('postgres:exists', name)
    if (!exists) { logSkip(); continue }
    await ctx.run('postgres:destroy', name, '--force')
    logDone()
  }
}

export async function exportPostgres(
  ctx: Context,
  /** Receives each service's mounts as the host-path specs the server reports */
  mountSpecs?: Map<string, string[]>,
): Promise<Record<string, PostgresConfig>> {
  const services: Record<string, PostgresConfig> = {}
  const listOutput = await ctx.query('postgres:list')
  const lines = listOutput.split('\n').slice(1)

  for (const line of lines) {
    const name = line.trim().split(/\s+/)[0]
    if (!name) continue

    const infoOutput = await ctx.query('postgres:info', name)
    const versionMatch = infoOutput.match(/Version:\s+(\S+)/)
    if (!versionMatch) continue

    const versionField = versionMatch[1]
    const colonIdx = versionField.lastIndexOf(':')

    const config: PostgresConfig = {}
    if (colonIdx > 0) {
      const image = versionField.slice(0, colonIdx)
      const version = versionField.slice(colonIdx + 1)
      if (image !== 'postgres') config.image = image
      if (version) config.version = version
    } else {
      config.version = versionField
    }

    const backup = await exportServiceBackup(ctx, 'postgres', name)
    if (backup) config.backup = backup

    const exported = await exportServiceProperties(ctx, 'postgres', name)
    if (exported.properties) config.properties = exported.properties
    if (exported.mountSpecs) mountSpecs?.set(name, exported.mountSpecs)

    services[name] = config
  }

  return services
}
