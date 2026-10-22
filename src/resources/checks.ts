import type { Resource } from '../core/reconcile.js'
import type { Change } from '../core/change.js'
import type { Context } from '../core/context.js'
import { parseReport } from './parsers.js'
import { logWarn } from '../core/logger.js'

/** The only `checks:set` key (Dokku 0.38.31 `plugins/checks/subcommands/set`); `disabled` and `skipped` come from `checks:disable`/`:skip`. */
export const CHECKS_KEYS = ['wait-to-retire'] as const

type ChecksConfig = false | {
  disabled?: string[]
  skipped?: string[]
  'wait-to-retire'?: string | number | boolean
}

export const Checks: Resource<ChecksConfig> = {
  key: 'checks',
  // Settable state: the per-process lists and `wait-to-retire`. A list of "none" is empty;
  // a disabled list of `_all_` (`checks:disable <app>` with no types) reads as `false`.
  read: async (ctx: Context, target: string) => {
    const report = parseReport(await ctx.query('checks:report', target), 'checks')
    // Dokku always prints the disabled list ("none" when empty); without it the read failed.
    if (report['disabled-list'] === undefined) return undefined as unknown as ChecksConfig
    if (report['disabled-list'] === '_all_') return false
    const current: Record<string, string> = {}
    for (const [reportKey, key] of [['disabled-list', 'disabled'], ['skipped-list', 'skipped']]) {
      const v = report[reportKey]
      if (v && v !== 'none' && v !== '_all_') current[key] = v
    }
    if (report['wait-to-retire']) current['wait-to-retire'] = report['wait-to-retire']
    return current as ChecksConfig
  },
  removals: (current, desired) =>
    desired === false ? [] :
    Object.keys(current || {}).filter(k => !(desired && k in desired)),
  prune: async (ctx, target, removed, current, desired) => {
    const cur = current as Record<string, string>
    const split = (v?: string) => (v ?? '').split(',').map(t => t.trim()).filter(Boolean)
    const declared = new Set(desired ? [...(desired.disabled ?? []), ...(desired.skipped ?? [])] : [])
    const stale = new Set(removed.filter(k => k === 'disabled' || k === 'skipped').flatMap(k => split(cur[k])))
    // `checks:enable` clears a type's disabled AND skipped state, so a type the file
    // declares in either list cannot be pruned without changing declared state.
    const enable = [...stale].filter(t => !declared.has(t))
    for (const t of stale) {
      if (declared.has(t)) {
        logWarn(target, `checks: '${t}' is declared in the file but also set in a list the file does not declare; left as is. Run 'dokku checks:enable ${target} ${t}' and then 'up' to clear it`)
      }
    }
    if (enable.length > 0) await ctx.run('checks:enable', target, enable.join(','))
    if (removed.includes('wait-to-retire')) await ctx.run('checks:set', target, 'wait-to-retire')
  },
  inSync: (current, desired) => checksCalls(current, desired).length === 0,
  onChange: async (ctx, target, { before, after }: Change<ChecksConfig>) => {
    if (before === undefined) throw new Error('checks: could not read checks:report; left as is')
    for (const call of checksCalls(before, after)) await ctx.run(call[0], target, ...call.slice(1))
  },
}

/**
 * The calls that take the server's checks state to the declared one, without
 * the app name: none when they already match. A declared list must be a
 * subset of the server's (types only on the server are pruned, not reset here).
 * Dokku takes the process types as one comma-separated argument
 * (Dokku 0.38.31 plugins/checks/subcommands/disable reads only `$2`).
 */
function checksCalls(current: ChecksConfig | undefined, desired: ChecksConfig): string[][] {
  if (desired === false) return current === false ? [] : [['checks:disable']]
  const calls: string[][] = []
  const cur = (current || {}) as Record<string, string>
  // Every type was disabled; the file declares per-type state instead.
  if (current === false) calls.push(['checks:enable'])
  const split = (v?: string) => (v ?? '').split(',').map(t => t.trim()).filter(Boolean)
  for (const [key, cmd] of [['disabled', 'checks:disable'], ['skipped', 'checks:skip']] as const) {
    const have = new Set(split(cur[key]))
    const missing = (desired[key] ?? []).filter(t => !have.has(t))
    if (missing.length > 0) calls.push([cmd, missing.join(',')])
  }
  for (const [key, value] of Object.entries(desired)) {
    if (key === 'disabled' || key === 'skipped') continue
    if (cur[key] !== String(value)) calls.push(['checks:set', key, String(value)])
  }
  return calls
}
