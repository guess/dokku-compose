import type { Context } from '../core/context.js'

export interface ServiceMismatch {
  field: 'version' | 'image'
  desired: string
  current: string
}

/**
 * Compare a datastore service's declared `version` and `image` with what
 * `<plugin>:info <svc> --format json` reports (`image-version`, `image`).
 * A field the file does not declare never drifts. Throws when the read fails
 * or is not JSON, so callers can report the service as unknown.
 */
export async function readServiceMismatches(
  ctx: Context,
  plugin: 'postgres' | 'redis',
  name: string,
  declared: { version?: string; image?: string },
): Promise<ServiceMismatch[]> {
  if (declared.version === undefined && declared.image === undefined) return []
  const raw = await ctx.queryStrict(`${plugin}:info`, name, '--format', 'json')
  let info: Record<string, unknown>
  try {
    info = JSON.parse(raw)
  } catch {
    throw new Error(`${plugin}:info ${name} --format json did not return JSON`)
  }
  const out: ServiceMismatch[] = []
  const current = (key: string) => String(info[key] ?? '')
  if (declared.version !== undefined && declared.version !== current('image-version')) {
    out.push({ field: 'version', desired: declared.version, current: current('image-version') })
  }
  if (declared.image !== undefined && declared.image !== current('image')) {
    out.push({ field: 'image', desired: declared.image, current: current('image') })
  }
  return out
}
