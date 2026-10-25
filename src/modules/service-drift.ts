import type { Context } from '../core/context.js'

export interface ServiceMismatch {
  field: string
  desired: string
  current: string
  /** The server holds it and the file does not declare it: `diff` shows a `-`, and only `--prune` clears it */
  removed?: boolean
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

/** Drop the cached info of a service after a command changed it, so the next read sees the change. */
export function forgetServiceInfo(ctx: Context, plugin: 'postgres' | 'redis', name: string): void {
  infoReads.get(ctx)?.delete(`${plugin}\0${name}`)
}

async function fetchServiceInfo(ctx: Context, plugin: 'postgres' | 'redis', name: string): Promise<ServiceInfo> {
  const raw = await ctx.queryStrict(`${plugin}:info`, name, '--format', 'json')
  try {
    const info = JSON.parse(raw)
    if (info && typeof info === 'object' && !Array.isArray(info)) return info as ServiceInfo
  } catch { /* reported below; the JSON carries the dsn, so never echo it */ }
  throw new Error(`${plugin}:info ${name} --format json did not return JSON`)
}

export const field = (info: ServiceInfo, key: string) => String(info[key] ?? '')

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
