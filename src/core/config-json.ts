/**
 * Parse `dokku config:export --format json` output into a key -> string map.
 * Throws on anything that is not a JSON object, so a bad export is an error
 * and never an empty env.
 */
export function parseConfigJson(raw: string, what: string): Record<string, string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${what}: config:export did not return JSON`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${what}: config:export did not return a JSON object`)
  }
  const result: Record<string, string> = {}
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) result[k] = String(v)
  return result
}
