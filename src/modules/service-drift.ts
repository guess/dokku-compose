import { createHash } from 'crypto'
import type { Context } from '../core/context.js'
import type { ServiceBackupConfig } from '../core/schema.js'

export interface ServiceMismatch {
  field: 'version' | 'image' | 'backup.auth' | 'backup.schedule' | 'backup.bucket' | 'backup'
  desired: string
  current: string
}

export type ServiceInfo = Record<string, unknown>

const infoReads = new WeakMap<Context, Map<string, Promise<ServiceInfo>>>()

/**
 * `<plugin>:info <svc> --format json`, parsed, read once per context so the
 * version check and the backup check share one call. Throws when the read
 * fails or is not JSON (a failure is not cached).
 */
export function readServiceInfo(
  ctx: Context,
  plugin: 'postgres' | 'redis',
  name: string,
): Promise<ServiceInfo> {
  let reads = infoReads.get(ctx)
  if (!reads) { reads = new Map(); infoReads.set(ctx, reads) }
  const key = `${plugin}\0${name}`
  let read = reads.get(key)
  if (!read) {
    read = fetchServiceInfo(ctx, plugin, name)
    read.catch(() => reads!.delete(key))
    reads.set(key, read)
  }
  return read
}

async function fetchServiceInfo(ctx: Context, plugin: 'postgres' | 'redis', name: string): Promise<ServiceInfo> {
  const raw = await ctx.queryStrict(`${plugin}:info`, name, '--format', 'json')
  try {
    const info = JSON.parse(raw)
    if (info && typeof info === 'object' && !Array.isArray(info)) return info as ServiceInfo
  } catch { /* reported below; the JSON carries the dsn, so never echo it */ }
  throw new Error(`${plugin}:info ${name} --format json did not return JSON`)
}

const field = (info: ServiceInfo, key: string) => String(info[key] ?? '')

/**
 * Compare a service's declared `version` and `image` with the info's
 * `image-version` and `image`. A field the file does not declare never drifts.
 */
export function versionMismatches(
  info: ServiceInfo,
  declared: { version?: string; image?: string },
): ServiceMismatch[] {
  const out: ServiceMismatch[] = []
  if (declared.version !== undefined && declared.version !== field(info, 'image-version')) {
    out.push({ field: 'version', desired: declared.version, current: field(info, 'image-version') })
  }
  if (declared.image !== undefined && declared.image !== field(info, 'image')) {
    out.push({ field: 'image', desired: declared.image, current: field(info, 'image') })
  }
  return out
}

/** Reads `<plugin>:info` and compares version and image (skips the read when neither is declared). */
export async function readServiceMismatches(
  ctx: Context,
  plugin: 'postgres' | 'redis',
  name: string,
  declared: { version?: string; image?: string },
): Promise<ServiceMismatch[]> {
  if (declared.version === undefined && declared.image === undefined) return []
  return versionMismatches(await readServiceInfo(ctx, plugin, name), declared)
}

/**
 * What dokku-datastore reports as `backup-auth-fingerprint`: the lowercase hex
 * sha256 of the access key id and the secret joined by one newline.
 */
export function backupAuthFingerprint(accessKeyId: string, secretAccessKey: string): string {
  return createHash('sha256').update(`${accessKeyId}\n${secretAccessKey}`).digest('hex')
}

/** Whether the server holds any backup schedule or credentials for the service. */
export function hasBackup(info: ServiceInfo): boolean {
  return field(info, 'backup-schedule') !== '' || field(info, 'backup-authenticated') === 'true'
}

/**
 * Compare a declared backup with the server's `backup-*` info keys.
 * Credentials are compared by fingerprint and never appear in the result.
 * `false` drifts when any backup is left on the server.
 */
export function backupMismatches(info: ServiceInfo, backup: ServiceBackupConfig | false): ServiceMismatch[] {
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

/** A one-line, credential-free description of the server's backup. */
export function describeServerBackup(info: ServiceInfo): string {
  const schedule = field(info, 'backup-schedule')
  const parts: string[] = []
  if (schedule) parts.push(`scheduled ${schedule} to ${field(info, 'backup-bucket')}`)
  if (field(info, 'backup-authenticated') === 'true') parts.push('credentials stored')
  return parts.join(', ') || 'none'
}
