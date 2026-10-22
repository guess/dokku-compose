import type { Context } from '../core/context.js'
import type { PluginConfig } from '../core/schema.js'
import { logAction, logDone, logSkip, logWarn } from '../core/logger.js'

// All plugin command strings and the plugin:list parser live in this file.
// The plugin:list line format is assumed, not checked against a live box:
//   "  postgres             1.41.0 enabled    dokku postgres service plugin"
// i.e. name, version, enabled|disabled, description. The version is the one in
// the plugin's plugin.toml, not the git commit.

/** Parse `plugin:list` into { name: version }. Lines without enabled/disabled are ignored. */
export function parsePluginList(raw: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*(\S+)\s+(\S+)\s+(?:enabled|disabled)\b/)
    if (m) result.set(m[1], m[2])
  }
  return result
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/

/** Compare two versions after stripping a leading `v`. undefined when either is not x.y.z. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | undefined {
  const na = a.replace(/^v/, '')
  const nb = b.replace(/^v/, '')
  const ma = na.match(SEMVER)
  const mb = nb.match(SEMVER)
  if (!ma || !mb) return na === nb ? 0 : undefined
  for (let i = 1; i <= 3; i++) {
    const d = Number(ma[i]) - Number(mb[i])
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

export type PluginAction = 'install' | 'ok' | 'update' | 'newer' | 'unknown'

export interface PluginPlan {
  name: string
  action: PluginAction
  installed?: string
  desired?: string
}

export function planPlugins(listOutput: string, plugins: Record<string, PluginConfig>): PluginPlan[] {
  const installed = parsePluginList(listOutput)
  return Object.entries(plugins).map(([name, config]) => {
    const current = installed.get(name)
    const desired = config.version
    if (current === undefined) return { name, action: 'install', desired }
    if (desired === undefined) return { name, action: 'ok', installed: current }
    const cmp = compareVersions(current, desired)
    const action: PluginAction = cmp === undefined ? 'unknown' : cmp < 0 ? 'update' : cmp > 0 ? 'newer' : 'ok'
    return { name, action, installed: current, desired }
  })
}

export async function ensurePlugins(
  ctx: Context,
  plugins: Record<string, PluginConfig>
): Promise<void> {
  const plans = planPlugins(await ctx.query('plugin:list'), plugins)

  for (const plan of plans) {
    const config = plugins[plan.name]
    logAction('plugins', `Installing ${plan.name}`)
    switch (plan.action) {
      case 'install':
        await ctx.run('plugin:install', config.url,
          ...(config.version ? ['--committish', config.version] : []), '--name', plan.name)
        logDone()
        break
      case 'update':
        await ctx.run('plugin:update', plan.name, config.version!)
        logDone()
        break
      case 'newer':
        logWarn('plugins', `${plan.name} is ${plan.installed}, newer than the declared ${plan.desired}; leaving it (never downgrades)`)
        break
      case 'unknown':
        logWarn('plugins', `${plan.name} is ${plan.installed} and the declared ${plan.desired} cannot be compared; leaving it`)
        break
      default:
        logSkip()
    }
  }
}
