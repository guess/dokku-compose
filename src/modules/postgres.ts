import type { Context } from '../core/context.js'
import type { PostgresConfig } from '../core/schema.js'
import { logAction, logDone, logSkip, logWarn } from '../core/logger.js'
import { readServiceMismatches, readServiceInfo, backupMismatches, hasBackup, describeServerBackup } from './service-drift.js'
import { readGlobalEnv, BACKUP_HASH_PREFIX } from './config.js'

export async function ensurePostgres(
  ctx: Context,
  services: Record<string, PostgresConfig>
): Promise<void> {
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
    await ctx.run(...args)
    logDone()
  }
}

/**
 * Converge each service's backup with what `postgres:info --format json`
 * reports. Credentials are compared by fingerprint, so a rotated key is
 * picked up, and are only ever passed to `:backup-auth` (masked in logs).
 * Only `backup: false` removes a backup; an absent block leaves it alone.
 */
export async function ensurePostgresBackups(
  ctx: Context,
  services: Record<string, PostgresConfig>,
  opts: { prune?: boolean } = {}
): Promise<void> {
  for (const [name, config] of Object.entries(services)) {
    const backup = config.backup
    if (backup === undefined && !opts.prune) continue
    const info = await readServiceInfo(ctx, 'postgres', name)

    if (backup === undefined) {
      if (hasBackup(info)) {
        logWarn('services', `${name}: has a backup the file does not declare (${describeServerBackup(info)}); --prune leaves it, set backup: false to remove it`)
      }
      continue
    }

    logAction('services', `Configuring backup for ${name}`)
    const fields = new Set(backupMismatches(info, backup).map(m => m.field))
    if (fields.size === 0) { logSkip(); continue }

    if (backup === false) {
      if (String(info['backup-schedule'] ?? '') !== '') await ctx.run('postgres:backup-unschedule', name)
      // deauth removes the whole backup folder, credentials included
      await ctx.run('postgres:backup-deauth', name)
      logDone()
      continue
    }

    const { schedule, bucket, auth } = backup
    // NOTE: never call `postgres:backup-deauth` before `backup-auth`: deauth
    // wipes the per-service backup directory and cron file, so a failed auth
    // would leave no backups at all. `backup-auth` replaces the stored
    // credentials in place.
    if (fields.has('backup.auth')) {
      await ctx.run(
        'postgres:backup-auth', name,
        auth.access_key_id, auth.secret_access_key,
        auth.region, auth.signature_version, auth.endpoint
      )
    }
    if (fields.has('backup.schedule')) {
      await ctx.run('postgres:backup-schedule', name, schedule, bucket)
      // Check the schedule landed: a silent failure would otherwise leave no backups.
      const cronOutput = await ctx.query('postgres:backup-schedule-cat', name)
      if (!parseBackupSchedule(cronOutput)) {
        throw new Error(`Backup schedule for ${name} was not installed after backup-schedule ran`)
      }
    } else if (fields.has('backup.bucket')) {
      await ctx.run('postgres:set', name, 'backup-bucket', bucket)
    }
    logDone()
  }
}

/**
 * Unset the global `DOKKU_COMPOSE_BACKUP_HASH_*` keys earlier versions kept
 * (Dokku merges global env into every app). Global unset never restarts apps.
 */
export async function removeBackupHashKeys(ctx: Context): Promise<void> {
  const stale = staleBackupHashKeys(await readGlobalEnv(ctx))
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

function parseBackupSchedule(
  cronLine: string
): { schedule: string; bucket: string } | null {
  // Used to check a schedule landed and for export only; drift reads postgres:info.
  // Format: "0 * * * * dokku /usr/bin/dokku postgres:backup <name> <bucket>"
  const parts = cronLine.trim().split(/\s+/)
  if (parts.length < 8) return null
  const schedule = parts.slice(0, 5).join(' ')
  const bucket = parts[parts.length - 1]
  return { schedule, bucket }
}

export async function exportPostgres(
  ctx: Context
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

    try {
      const cronOutput = await ctx.query('postgres:backup-schedule-cat', name)
      if (cronOutput) {
        const parsed = parseBackupSchedule(cronOutput)
        if (parsed) {
          config.backup = {
            schedule: parsed.schedule,
            bucket: parsed.bucket,
            auth: {
              access_key_id: 'REPLACE_ME',
              secret_access_key: 'REPLACE_ME',
              region: 'REPLACE_ME',
              signature_version: 'REPLACE_ME',
              endpoint: 'REPLACE_ME',
            },
          }
        }
      }
    } catch {
      // No backup configured for this service
    }

    services[name] = config
  }

  return services
}
