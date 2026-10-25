import { createHash } from 'crypto'
import type { Context } from '../core/context.js'
import type { ServiceBackupConfig } from '../core/schema.js'
import { logAction, logDone, logSkip, logWarn } from '../core/logger.js'
import { readServiceInfo, field, type ServiceInfo, type ServiceMismatch } from './service-drift.js'

/** The datastore plugins that share one backup implementation. */
export type BackupPlugin = 'postgres' | 'redis'

/**
 * What dokku-datastore reports as `backup-auth-fingerprint`: the lowercase hex
 * sha256 of the access key id and the secret joined by one newline.
 */
export function backupAuthFingerprint(accessKeyId: string, secretAccessKey: string): string {
  // Dokku stores each credential in a file and fingerprints its trimmed first line.
  const firstLine = (v: string) => v.trim().split('\n')[0].trim()
  return createHash('sha256').update(`${firstLine(accessKeyId)}\n${firstLine(secretAccessKey)}`).digest('hex')
}

/** Whether the server holds any backup schedule or credentials for the service. */
export function hasBackup(info: ServiceInfo): boolean {
  return field(info, 'backup-schedule') !== '' || field(info, 'backup-authenticated') === 'true'
}

/** A one-line, credential-free description of the server's backup. */
export function describeServerBackup(info: ServiceInfo): string {
  const schedule = field(info, 'backup-schedule')
  const parts: string[] = []
  if (schedule) parts.push(`scheduled ${schedule} to ${field(info, 'backup-bucket')}`)
  if (field(info, 'backup-authenticated') === 'true') parts.push('credentials stored')
  return parts.join(', ') || 'none'
}

/**
 * Compare a declared backup with the server's `backup-*` info keys.
 * Credentials are compared by fingerprint and never appear in the result.
 * `false` drifts when any backup is left on the server.
 */
export function backupMismatches(plugin: BackupPlugin, info: ServiceInfo, backup: ServiceBackupConfig | false): ServiceMismatch[] {
  // An absent key is not an empty value: an older plugin would read as "no backup" and re-apply every run.
  if (!('backup-auth-fingerprint' in info)) throw new Error(`dokku-${plugin} too old to report backup state (needs 2.3.1+)`)
  if (backup === false) {
    return hasBackup(info) ? [{ field: 'backup', desired: 'none', current: describeServerBackup(info) }] : []
  }
  const out: ServiceMismatch[] = []
  const { auth } = backup
  const authDiffers: string[] = []
  if (field(info, 'backup-auth-fingerprint') !== backupAuthFingerprint(auth.access_key_id, auth.secret_access_key)) {
    authDiffers.push('credentials')
  }
  if (field(info, 'backup-default-region') !== auth.region) authDiffers.push('region')
  if (field(info, 'backup-signature-version') !== auth.signature_version) authDiffers.push('signature version')
  if (field(info, 'backup-endpoint-url') !== auth.endpoint) authDiffers.push('endpoint')
  if (authDiffers.length > 0) {
    out.push({
      field: 'backup.auth',
      desired: `${authDiffers.join(', ')} from the file`,
      current: field(info, 'backup-authenticated') === 'true' ? 'other values' : 'not authenticated',
    })
  }
  if (field(info, 'backup-schedule') !== backup.schedule) {
    out.push({ field: 'backup.schedule', desired: backup.schedule, current: field(info, 'backup-schedule') })
  }
  if (field(info, 'backup-bucket') !== backup.bucket) {
    out.push({ field: 'backup.bucket', desired: backup.bucket, current: field(info, 'backup-bucket') })
  }
  return out
}

/**
 * Converge each service's backup with what `<plugin>:info --format json`
 * reports. Credentials are compared by fingerprint, so a rotated key is
 * picked up, and are only ever passed to `:backup-auth` (masked in logs).
 * Only `backup: false` removes a backup; an absent block leaves it alone.
 * `dryRunCreated` names services this --dry-run only planned to create: they
 * cannot be read, and a new service has no backup, so every step is planned.
 * `dryRun` skips the check that a new schedule landed, since nothing ran.
 */
export async function ensureServiceBackups(
  ctx: Context,
  plugin: BackupPlugin,
  services: Record<string, { backup?: ServiceBackupConfig | false }>,
  opts: { prune?: boolean; dryRun?: boolean; dryRunCreated?: Set<string> } = {}
): Promise<void> {
  for (const [name, config] of Object.entries(services)) {
    const backup = config.backup
    if (backup === undefined && !opts.prune) continue

    if (backup === undefined) {
      // Only a warning can come of this, so a failed read (a service created
      // on this --dry-run, a transient error) never stops the run.
      let info
      try {
        info = await readServiceInfo(ctx, plugin, name)
      } catch (err) {
        logWarn('services', `could not read backup state for ${name}: ${err instanceof Error ? err.message : String(err)}`)
        continue
      }
      if (hasBackup(info)) {
        logWarn('services', `${name}: has a backup the file does not declare (${describeServerBackup(info)}); --prune leaves it, set backup: false to remove it`)
      }
      continue
    }

    if (opts.dryRunCreated?.has(name)) {
      logAction('services', `Configuring backup for ${name}`)
      if (backup !== false) {
        const { schedule, bucket, auth } = backup
        await ctx.run(
          `${plugin}:backup-auth`, name,
          auth.access_key_id, auth.secret_access_key,
          auth.region, auth.signature_version, auth.endpoint
        )
        await ctx.run(`${plugin}:backup-schedule`, name, schedule, bucket)
      }
      logDone()
      continue
    }

    const info = await readServiceInfo(ctx, plugin, name)
    logAction('services', `Configuring backup for ${name}`)
    const fields = new Set(backupMismatches(plugin, info, backup).map(m => m.field))
    if (fields.size === 0) { logSkip(); continue }

    if (backup === false) {
      // Always name the default schedule: without --id the plugin refuses when the service has others.
      if (field(info, 'backup-schedule') !== '') await ctx.run(`${plugin}:backup-unschedule`, name, '--id', 'default')
      // deauth removes the credentials
      await ctx.run(`${plugin}:backup-deauth`, name)
      logDone()
      continue
    }

    const { schedule, bucket, auth } = backup
    // NOTE: never call `<plugin>:backup-deauth` before `backup-auth`: a failed
    // auth would leave no backups at all. `backup-auth` replaces the stored
    // credentials in place.
    if (fields.has('backup.auth')) {
      await ctx.run(
        `${plugin}:backup-auth`, name,
        auth.access_key_id, auth.secret_access_key,
        auth.region, auth.signature_version, auth.endpoint
      )
    }
    if (fields.has('backup.schedule')) {
      await ctx.run(`${plugin}:backup-schedule`, name, schedule, bucket)
      // Check the schedule landed: a silent failure would otherwise leave no backups.
      if (!opts.dryRun) {
        const cronOutput = await ctx.query(`${plugin}:backup-schedule-cat`, name)
        if (!parseBackupSchedule(cronOutput)) {
          throw new Error(`Backup schedule for ${name} was not installed after backup-schedule ran`)
        }
      }
    } else if (fields.has('backup.bucket')) {
      await ctx.run(`${plugin}:set`, name, 'backup-bucket', bucket)
    }
    logDone()
  }
}

/** Parse a `backup-schedule-cat` line; used to check a schedule landed. */
export function parseBackupSchedule(
  cronLine: string
): { schedule: string; bucket: string } | null {
  // Format: "0 * * * * dokku /usr/bin/dokku <plugin>:backup <name> <bucket>"
  const parts = cronLine.trim().split(/\s+/)
  if (parts.length < 8) return null
  const schedule = parts.slice(0, 5).join(' ')
  const bucket = parts[parts.length - 1]
  return { schedule, bucket }
}

/** The `backup:` block `export` writes for a service: credentials are never read back. */
export async function exportServiceBackup(
  ctx: Context,
  plugin: BackupPlugin,
  name: string,
): Promise<ServiceBackupConfig | undefined> {
  let cronOutput = ''
  try {
    cronOutput = await ctx.query(`${plugin}:backup-schedule-cat`, name)
  } catch {
    return undefined // No backup configured for this service
  }
  const parsed = cronOutput ? parseBackupSchedule(cronOutput) : null
  if (!parsed) return undefined
  return {
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
