import type { Resource } from '../core/reconcile.js'
import { parseConfigJson } from '../core/config-json.js'
import type { MapChange } from '../core/change.js'

const MANAGED_KEYS_VAR = 'DOKKU_COMPOSE_MANAGED_KEYS'
const MISSING = '\u0000missing'

export const Config: Resource<Record<string, string | number | boolean>> = {
  key: 'env',
  removals: (current, desired) =>
    Object.keys(current ?? {}).filter(k => !(desired && typeof desired === 'object' && k in desired)),
  read: async (ctx, target) => {
    const managedRaw = await ctx.query('config:get', target, MANAGED_KEYS_VAR)
    const managedKeys = managedRaw.trim() ? managedRaw.trim().split(',').filter(Boolean) : []
    const result: Record<string, string> = {}
    // A marked key that is already gone from the app still counts as present
    // (with a value no desired value equals), so a stale marker is cleaned up
    // and a drifted key is set again.
    for (const k of managedKeys) result[k] = MISSING
    if (managedKeys.length > 0) {
      const raw = await ctx.queryStrict('config:export', '--format', 'json', target)
      const current = parseConfigJson(raw, target)
      for (const k of managedKeys) {
        if (k in current) result[k] = current[k]
      }
    }
    return result
  },
  onChange: async (ctx, target, change: MapChange) => {
    const { added, removed, modified } = change
    if (removed.length > 0) {
      // If this throws, the marker is untouched and still names the keys,
      // so the next run retries.
      await ctx.run('config:unset', '--no-restart', target, ...removed)
    }
    const allDesiredKeys = Object.keys(change.after)
    if (allDesiredKeys.length === 0) {
      // Whole block gone: drop the marker itself (never write it empty).
      await ctx.run('config:unset', '--no-restart', target, MANAGED_KEYS_VAR)
      return
    }
    const toSet = { ...added, ...modified }
    if (Object.keys(toSet).length > 0 || removed.length > 0) {
      const pairs = Object.entries(change.after).map(([k, v]) => `${k}=${v}`)
      await ctx.run(
        'config:set', '--no-restart', target,
        ...pairs,
        `${MANAGED_KEYS_VAR}=${allDesiredKeys.join(',')}`
      )
    }
  },
}
