/**
 * Parse Dokku report output into a key-value map.
 * Report format: "       Namespace key name:   value"
 * Keys are normalized: lowercase, spaces to hyphens, namespace prefix stripped.
 * Computed, global, and meta keys are excluded.
 * Empty values are excluded.
 */
export function parseReport(raw: string, namespace: string): Record<string, string> {
  const result: Record<string, string> = {}
  const prefixPattern = namespace.replace(/-/g, '[\\s-]')
  const prefix = new RegExp(`^${prefixPattern}\\s+`, 'i')

  for (const line of raw.split('\n')) {
    // Skip header lines (=====> ...)
    if (line.trimStart().startsWith('=====>')) continue

    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue

    const rawKey = line.slice(0, colonIdx).trim()
    if (!rawKey) continue

    const value = line.slice(colonIdx + 1).trim()

    // Strip namespace prefix and normalize
    const stripped = rawKey.replace(prefix, '')
    const key = stripped.toLowerCase().replace(/\s+/g, '-')

    // Skip computed, global, and meta keys
    if (key.startsWith('computed-') || key.startsWith('global-') || key === 'last-visited-at') continue

    // Skip empty values
    if (!value) continue

    result[key] = value
  }

  return result
}

/**
 * Parse bulk Dokku report output (all apps) into a Map of app -> key-value maps.
 * Splits on "=====> <app> <namespace> information" headers, then delegates
 * each section to parseReport.
 */
/**
 * Parse bulk Dokku report output (all apps) into a Map of app -> key-value maps.
 * Splits on "=====> <app> <header> information" headers, then delegates
 * each section to parseReport.
 *
 * @param namespace - Used for stripping key prefixes in parseReport
 * @param headerNamespace - Used for matching the header line (defaults to namespace).
 *   Needed when the header uses a different word than the key prefix (e.g. header
 *   says "certs information" but keys start with "Ssl").
 */
export function parseBulkReport(raw: string, namespace: string, headerNamespace?: string): Map<string, Record<string, string>> {
  const result = new Map<string, Record<string, string>>()
  const sections = raw.split(/(?=^=====> )/m).filter(s => s.trim())
  // Build regex that matches the namespace in the header (hyphens may be spaces)
  const nsPattern = (headerNamespace ?? namespace).replace(/-/g, '[\\s-]')
  const headerRe = new RegExp(`^=====> (.+?)\\s+${nsPattern}\\s+information`, 'i')

  for (const section of sections) {
    const headerEnd = section.indexOf('\n')
    if (headerEnd === -1) continue
    const header = section.slice(0, headerEnd)
    const match = header.match(headerRe)
    if (!match) continue
    const app = match[1]
    result.set(app, parseReport(section, namespace))
  }

  return result
}

/**
 * Parse a `<namespace>:report <app|--global> --format json` object. Dokku trims
 * the `--<namespace>-` prefix from each key, so an app's own settings are bare
 * (`max-size`) and the others start with `global-` or `computed-`. Some
 * plugins (logs, Dokku 0.38.31 `EmitLegacyPrefix: true`) also print every key
 * again with the `<namespace>-` prefix. With `scope: 'global'` only the
 * `global-` keys are kept, prefix stripped; with an array, only those bare
 * app keys. Empty values are unset and dropped. Throws on output that is not
 * a JSON object, so a failed read is never an empty report.
 */
export function parseJsonReport(raw: string, scope: 'global' | readonly string[]): Record<string, string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`report --format json did not return JSON: ${raw.slice(0, 200)}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`report --format json did not return a JSON object: ${raw.slice(0, 200)}`)
  }
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value === null || value === undefined || String(value) === '') continue
    if (scope === 'global') {
      if (key.startsWith('global-')) result[key.slice('global-'.length)] = String(value)
    } else if (scope.includes(key)) {
      result[key] = String(value)
    }
  }
  return result
}
