import { createHash } from 'crypto'
import type { Context } from '../core/context.js'
import { EXPORT_PLACEHOLDER, type ServiceBackupConfig } from '../core/schema.js'
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

type Encryption = NonNullable<ServiceBackupConfig['encryption']>

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex')

/** The `set` properties of the optional settings, with how each reads back from `info`. */
const SETTINGS = [
  { key: 'storage_class', property: 'backup-storage-class' },
  { key: 'object_name', property: 'backup-object-name' },
  { key: 'mailto', property: 'backup-mailto' },
] as const

/**
 * Ids of the schedules other than `default`, from `backup-schedules`
 * (`id|cron|bucket|use-iam` records, `;` apart). Empty on a plugin that does
 * not report the key (before 2.5.0), so nothing is said there.
 */
export function otherScheduleIds(info: ServiceInfo): string[] {
  const raw = info['backup-schedules']
  const ids = Array.isArray(raw)
    ? raw.map(r => String((r as { id?: unknown })?.id ?? ''))
    : String(raw ?? '').split(';').map(r => r.split('|')[0])
  return ids.filter(id => id !== '' && id !== 'default')
}

const passphraseStored = (info: ServiceInfo) => field(info, 'backup-encryption-fingerprint') !== ''
const publicKeyStored = (info: ServiceInfo) => field(info, 'backup-public-key-id') !== ''
const encryptionStored = (info: ServiceInfo) => passphraseStored(info) || publicKeyStored(info) || field(info, 'backup-keyserver') !== ''
/** Names of the optional settings the server holds a value for (`timestamp` only when disabled). */
function settingsStored(info: ServiceInfo): string[] {
  const out: string[] = SETTINGS.filter(s => field(info, s.property) !== '').map(s => s.key)
  if (field(info, 'backup-timestamp') === 'false') out.push('timestamp')
  return out
}

/** Whether the server holds a backup schedule, credentials, encryption or backup settings for the service. */
export function hasBackup(info: ServiceInfo): boolean {
  return field(info, 'backup-schedule') !== '' || field(info, 'backup-authenticated') === 'true' ||
    encryptionStored(info) || settingsStored(info).length > 0
}

/** A one-line, secret-free description of the server's backup. */
export function describeServerBackup(info: ServiceInfo): string {
  const schedule = field(info, 'backup-schedule')
  const parts: string[] = []
  if (schedule) parts.push(`scheduled ${schedule} to ${field(info, 'backup-bucket')}`)
  if (field(info, 'backup-authenticated') === 'true') parts.push('credentials stored')
  if (encryptionStored(info)) parts.push('encrypted')
  const settings = settingsStored(info)
  if (settings.length > 0) parts.push(`with ${settings.join(', ')} set`)
  return parts.join(', ') || 'none'
}

/** Whether a declared block needs the keys 2.3.0 added to `info` (the 2.2.0 keys are always needed). */
function declaresNewerKeys(backup: ServiceBackupConfig): boolean {
  return backup.encryption !== undefined || backup.timestamp !== undefined ||
    SETTINGS.some(s => backup[s.key] !== undefined)
}

function assertReportsBackup(plugin: BackupPlugin, info: ServiceInfo, backup: ServiceBackupConfig | false): void {
  // An absent key is not an empty value: an older plugin would read as "no backup" and re-apply every run.
  const needed = ['backup-auth-fingerprint']
  if (backup !== false && declaresNewerKeys(backup)) needed.push('backup-timestamp', 'backup-mailto')
  if (needed.some(key => !(key in info))) throw new Error(`dokku-${plugin} too old to report backup state (needs 2.3.1+)`)
}

/** The mismatch between a declared encryption and what the server stores, never naming a passphrase. */
function encryptionMismatch(info: ServiceInfo, enc: Encryption): ServiceMismatch | undefined {
  const fingerprint = field(info, 'backup-encryption-fingerprint')
  const keyId = field(info, 'backup-public-key-id')
  const keyserver = field(info, 'backup-keyserver')
  const stored: string[] = []
  if (enc === false) {
    if (passphraseStored(info)) stored.push('a passphrase')
    if (keyId !== '') stored.push(`public key ${keyId}`)
    if (keyserver !== '') stored.push(`keyserver ${keyserver}`)
    return stored.length ? { field: 'backup.encryption', desired: 'none', current: stored.join(', ') } : undefined
  }
  if (enc.passphrase !== undefined) {
    if (fingerprint !== sha256(enc.passphrase)) stored.push(fingerprint === '' ? 'no passphrase' : 'a different passphrase')
    if (keyId !== '') stored.push(`public key ${keyId}`)
    if (keyserver !== '') stored.push(`keyserver ${keyserver}`)
    return stored.length ? { field: 'backup.encryption', desired: 'passphrase', current: stored.join(', ') } : undefined
  }
  if (keyId !== enc.public_key_id) stored.push(keyId === '' ? 'no public key' : `public key ${keyId}`)
  if (keyserver !== (enc.keyserver ?? '')) stored.push(`keyserver ${keyserver || 'none'}`)
  if (passphraseStored(info)) stored.push('a passphrase')
  return stored.length ? {
    field: 'backup.encryption',
    desired: `public key ${enc.public_key_id}${enc.keyserver ? ` on ${enc.keyserver}` : ''}`,
    current: stored.join(', '),
  } : undefined
}

/** `set` commands that make the server's encryption match; none when it already does. */
function encryptionCommands(plugin: BackupPlugin, name: string, info: ServiceInfo, enc: Encryption): string[][] {
  const set = (property: string, value?: string) => [`${plugin}:set`, name, property, ...(value === undefined ? [] : [value])]
  const cmds: string[][] = []
  const clearPassphrase = () => { if (passphraseStored(info)) cmds.push(set('backup-encryption-passphrase')) }
  const clearKeyId = () => { if (publicKeyStored(info)) cmds.push(set('backup-public-key-id')) }
  const clearKeyserver = () => { if (field(info, 'backup-keyserver') !== '') cmds.push(set('backup-keyserver')) }
  if (enc === false) {
    clearPassphrase(); clearKeyId(); clearKeyserver()
  } else if (enc.passphrase !== undefined) {
    if (field(info, 'backup-encryption-fingerprint') !== sha256(enc.passphrase)) cmds.push(set('backup-encryption-passphrase', enc.passphrase))
    // a public key takes precedence over a passphrase, so it must go
    clearKeyId(); clearKeyserver()
  } else {
    if (field(info, 'backup-keyserver') !== (enc.keyserver ?? '')) cmds.push(set('backup-keyserver', enc.keyserver))
    if (field(info, 'backup-public-key-id') !== enc.public_key_id) cmds.push(set('backup-public-key-id', enc.public_key_id))
    clearPassphrase()
  }
  return cmds
}

/** Mismatches of the optional settings: storage class, object name, mailto, timestamp. */
function settingMismatches(info: ServiceInfo, backup: ServiceBackupConfig): ServiceMismatch[] {
  const out: ServiceMismatch[] = []
  for (const { key, property } of SETTINGS) {
    const desired = backup[key]
    if (desired !== undefined && desired !== field(info, property)) out.push({ field: `backup.${key}`, desired, current: field(info, property) })
  }
  // `info` reports "true" unless disabled
  if (backup.timestamp === false && field(info, 'backup-timestamp') !== 'false') {
    out.push({ field: 'backup.timestamp', desired: 'false', current: field(info, 'backup-timestamp') || 'true' })
  }
  return out
}

function settingCommands(plugin: BackupPlugin, name: string, info: ServiceInfo, backup: ServiceBackupConfig): string[][] {
  const cmds: string[][] = []
  for (const { key, property } of SETTINGS) {
    const desired = backup[key]
    if (desired !== undefined && desired !== field(info, property)) cmds.push([`${plugin}:set`, name, property, desired])
  }
  if (backup.timestamp === false && field(info, 'backup-timestamp') !== 'false') cmds.push([`${plugin}:set`, name, 'backup-timestamp', 'false'])
  return cmds
}

/** `set` commands that clear the settings a `--prune` run finds on the server but not in the file. */
function pruneCommands(plugin: BackupPlugin, name: string, info: ServiceInfo, backup: ServiceBackupConfig): string[][] {
  const cmds: string[][] = []
  for (const { key, property } of SETTINGS) {
    if (backup[key] === undefined && field(info, property) !== '') cmds.push([`${plugin}:set`, name, property])
  }
  if (backup.timestamp === undefined && field(info, 'backup-timestamp') === 'false') cmds.push([`${plugin}:set`, name, 'backup-timestamp'])
  return cmds
}

/** `set` commands that clear everything `backup: false` takes with the backup, apart from the schedule and credentials. */
function clearAllCommands(plugin: BackupPlugin, name: string, info: ServiceInfo): string[][] {
  const cmds = encryptionCommands(plugin, name, info, false)
  for (const { property } of SETTINGS) if (field(info, property) !== '') cmds.push([`${plugin}:set`, name, property])
  if (field(info, 'backup-timestamp') === 'false') cmds.push([`${plugin}:set`, name, 'backup-timestamp'])
  return cmds
}

/**
 * Compare a declared backup with the server's `backup-*` info keys.
 * Credentials and passphrases are compared by fingerprint and never appear in the result.
 * `false` drifts when any backup, encryption or setting is left on the server.
 */
export function backupMismatches(plugin: BackupPlugin, info: ServiceInfo, backup: ServiceBackupConfig | false): ServiceMismatch[] {
  assertReportsBackup(plugin, info, backup)
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
  if (backup.encryption !== undefined) {
    const m = encryptionMismatch(info, backup.encryption)
    if (m) out.push(m)
  }
  out.push(...settingMismatches(info, backup))
  return out
}

/**
 * Notes `diff` shows beside a service's backup: things `up` leaves alone on
 * purpose. Never drift, and never name a secret.
 */
export function backupNotes(info: ServiceInfo, backup: ServiceBackupConfig | false | undefined): string[] {
  const notes: string[] = []
  if (backup === undefined) {
    if (hasBackup(info)) notes.push(`backup on the server is not in the file (${describeServerBackup(info)}); up leaves it, backup: false removes it`)
  } else if (backup !== false) {
    if (backup.encryption === undefined && encryptionStored(info)) {
      notes.push('backup encryption on the server is not in the file; up leaves it, encryption: false removes it')
    }
    const extra = [
      ...SETTINGS.filter(s => backup[s.key] === undefined && field(info, s.property) !== '').map(s => s.key),
      ...(backup.timestamp === undefined && field(info, 'backup-timestamp') === 'false' ? ['timestamp'] : []),
    ]
    if (extra.length > 0) notes.push(`backup ${extra.join(', ')} on the server ${extra.length === 1 ? 'is' : 'are'} not in the file; up leaves ${extra.length === 1 ? 'it' : 'them'}, up --prune clears ${extra.length === 1 ? 'it' : 'them'}`)
  }
  const others = otherScheduleIds(info)
  if (others.length > 0) notes.push(`other backup schedules (${others.join(', ')}) are not managed; up never touches them`)
  return notes
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
        // A new service has no encryption or settings, so every declared one is applied.
        const nothing: ServiceInfo = {}
        const cmds = [
          ...(backup.encryption !== undefined ? encryptionCommands(plugin, name, nothing, backup.encryption) : []),
          ...settingCommands(plugin, name, nothing, backup),
        ]
        for (const cmd of cmds) await ctx.run(...cmd)
      }
      logDone()
      continue
    }

    const info = await readServiceInfo(ctx, plugin, name)
    logAction('services', `Configuring backup for ${name}`)
    const fields = new Set(backupMismatches(plugin, info, backup).map(m => m.field))
    // --prune clears settings the declared block leaves out; encryption it only warns about.
    const prune = opts.prune && backup !== false ? pruneCommands(plugin, name, info, backup) : []
    if (opts.prune && backup !== false && backup.encryption === undefined && encryptionStored(info)) {
      logWarn('services', `${name}: has backup encryption the file does not declare; --prune leaves it, set encryption: false to remove it`)
    }
    if (fields.size === 0 && prune.length === 0) { logSkip(); continue }

    if (backup === false) {
      // Always name the default schedule: without --id the plugin refuses when the service has others.
      if (field(info, 'backup-schedule') !== '') await ctx.run(`${plugin}:backup-unschedule`, name, '--id', 'default')
      // deauth removes the credentials only: encryption and settings are cleared one by one
      if (field(info, 'backup-authenticated') === 'true') await ctx.run(`${plugin}:backup-deauth`, name)
      for (const cmd of clearAllCommands(plugin, name, info)) await ctx.run(...cmd)
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
      // `set backup-bucket` is refused while another schedule exists: re-run the default schedule instead.
      if (otherScheduleIds(info).length > 0) await ctx.run(`${plugin}:backup-schedule`, name, schedule, bucket)
      else await ctx.run(`${plugin}:set`, name, 'backup-bucket', bucket)
    }
    const cmds = [
      ...(backup.encryption !== undefined ? encryptionCommands(plugin, name, info, backup.encryption) : []),
      ...settingCommands(plugin, name, info, backup),
      ...prune,
    ]
    for (const cmd of cmds) await ctx.run(...cmd)
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

/**
 * The `backup:` block `export` writes for a service, from `<plugin>:info --format json`.
 * Secrets are never read back: credentials and a passphrase are `REPLACE_ME`.
 * A service with encryption or settings but no default schedule gets no block
 * (the schema requires schedule, bucket and auth) and a warning.
 */
export async function exportServiceBackup(
  ctx: Context,
  plugin: BackupPlugin,
  name: string,
): Promise<ServiceBackupConfig | undefined> {
  let info: ServiceInfo
  try {
    info = await readServiceInfo(ctx, plugin, name)
  } catch (err) {
    logWarn(name, `could not read the backup of ${plugin} service '${name}', left out of the export: ${err instanceof Error ? err.message : String(err)}`)
    return undefined
  }
  const schedule = field(info, 'backup-schedule')
  if (schedule === '') {
    if (hasBackup(info)) {
      logWarn(name, `${plugin} service '${name}' has backup ${describeServerBackup(info)} but no default schedule; its backup is left out of the export`)
    }
    return undefined
  }
  const out: ServiceBackupConfig = {
    schedule,
    bucket: field(info, 'backup-bucket'),
    auth: {
      access_key_id: EXPORT_PLACEHOLDER,
      secret_access_key: EXPORT_PLACEHOLDER,
      region: EXPORT_PLACEHOLDER,
      signature_version: EXPORT_PLACEHOLDER,
      endpoint: EXPORT_PLACEHOLDER,
    },
  }
  // A public key takes precedence over a passphrase on the server, so it is what is exported when both are stored.
  if (publicKeyStored(info)) {
    out.encryption = { public_key_id: field(info, 'backup-public-key-id') }
    if (field(info, 'backup-keyserver') !== '') out.encryption.keyserver = field(info, 'backup-keyserver')
  } else if (passphraseStored(info)) {
    out.encryption = { passphrase: EXPORT_PLACEHOLDER }
  }
  for (const { key, property } of SETTINGS) {
    if (field(info, property) !== '') (out as Record<string, unknown>)[key] = field(info, property)
  }
  if (field(info, 'backup-timestamp') === 'false') out.timestamp = false
  return out
}
