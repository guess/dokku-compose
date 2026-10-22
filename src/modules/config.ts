import { parseConfigJson } from '../core/config-json.js'
import type { Context } from '../core/context.js'

const MANAGED_KEYS_VAR = 'DOKKU_COMPOSE_MANAGED_KEYS'
/**
 * The keys of the top-level `env:` dokku-compose set globally. Separate from
 * the app marker because Dokku merges global env into every app's containers.
 */
export const GLOBAL_MANAGED_KEYS_VAR = 'DOKKU_COMPOSE_GLOBAL_MANAGED_KEYS'

/** Names dokku-compose keeps for itself: never set or unset as user keys. */
function isReserved(key: string): boolean {
  return key === GLOBAL_MANAGED_KEYS_VAR || key === MANAGED_KEYS_VAR || key.startsWith('DOKKU_COMPOSE_BACKUP_HASH_')
}

interface GlobalEnvPlan {
  /** Declared keys whose server value is absent or different. */
  toSet: Record<string, string>
  /** Keys the marker lists that the file no longer declares. */
  removed: string[]
  /** The marker value to write, '' to drop it. */
  marker: string
  markerOutdated: boolean
}

async function planGlobalEnv(ctx: Context, env: Record<string, string | number | boolean>): Promise<GlobalEnvPlan> {
  const current = parseConfigJson(await ctx.queryStrict('config:export', '--global', '--format', 'json'), '--global')
  const desired = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, String(v)]))
  // A box with no marker has nothing dokku-compose may remove.
  const managed = (current[GLOBAL_MANAGED_KEYS_VAR] ?? '').split(',').filter(Boolean)
  const removed = managed.filter(k => !(k in desired) && !isReserved(k) && k in current)
  const toSet = Object.fromEntries(Object.entries(desired).filter(([k, v]) => current[k] !== v))
  const marker = Object.keys(desired).join(',')
  const markerOutdated = [...managed].sort().join(',') !== Object.keys(desired).sort().join(',')
  return { toSet, removed, marker, markerOutdated }
}

/**
 * Converge the top-level `env:`. No `env:` block (undefined) counts as `{}`, so
 * marked keys are unset and the marker dropped; a box with no marker is left
 * alone. `env: false` skips global env. Returns whether a user key was set or
 * unset (a marker-only write is not a change apps can see).
 */
export async function ensureGlobalConfig(
  ctx: Context,
  env: Record<string, string | number | boolean> | false | undefined
): Promise<boolean> {
  if (env === false) return false
  const { toSet, removed, marker, markerOutdated } = await planGlobalEnv(ctx, env ?? {})
  const unset = [...removed]
  if (markerOutdated && marker === '') unset.push(GLOBAL_MANAGED_KEYS_VAR)
  // Unset first: if it throws, the marker still names the keys and the next run retries.
  if (unset.length > 0) await ctx.run('config:unset', '--global', ...unset)
  const pairs = Object.entries(toSet).map(([k, v]) => `${k}=${v}`)
  if (markerOutdated && marker !== '') pairs.push(`${GLOBAL_MANAGED_KEYS_VAR}=${marker}`)
  if (pairs.length > 0) await ctx.run('config:set', '--global', ...pairs)
  return Object.keys(toSet).length > 0 || removed.length > 0
}

/** For `diff`: the names (never values) of global keys `up` would set or unset. */
export async function readGlobalEnvDrift(
  ctx: Context,
  env: Record<string, string | number | boolean> | undefined
): Promise<{ changed: string[]; removed: string[]; markerOutdated: boolean }> {
  const { toSet, removed, markerOutdated } = await planGlobalEnv(ctx, env ?? {})
  return { changed: Object.keys(toSet), removed, markerOutdated }
}

export async function exportAppConfig(
  ctx: Context,
  app: string
): Promise<Record<string, string> | undefined> {
  const raw = await ctx.queryStrict('config:export', '--format', 'json', app)
  const result = parseConfigJson(raw, app)
  delete result[MANAGED_KEYS_VAR]
  return Object.keys(result).length > 0 ? result : undefined
}
