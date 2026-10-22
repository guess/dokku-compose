import type { Context } from '../core/context.js'
import type { PluginConfig } from '../core/schema.js'
import { logAction, logDone, logWarn } from '../core/logger.js'

// All plugin command strings and the plugin:list parser live in this file.
// Installed plugins are read from `plugin:list --format json`: an array of
// {name, version, enabled, core, committish, ...}. `version` is the one in the
// plugin's plugin.toml, not the git commit; `committish` is the checked-out
// commit (empty for core plugins).

export interface InstalledPlugin {
  version: string
  committish: string
}

/** Parse `plugin:list --format json` into name -> installed info. A plugin without a version is still installed. */
export function parsePluginList(raw: string): Map<string, InstalledPlugin> {
  const result = new Map<string, InstalledPlugin>()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return result
  }
  if (!Array.isArray(parsed)) return result
  for (const p of parsed) {
    if (p && typeof p.name === 'string') {
      result.set(p.name, {
        version: typeof p.version === 'string' ? p.version : '',
        committish: typeof p.committish === 'string' ? p.committish : '',
      })
    }
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

const SHA = /^[0-9a-f]{7,40}$/i

export function planPlugins(listOutput: string, plugins: Record<string, PluginConfig>): PluginPlan[] {
  const installed = parsePluginList(listOutput)
  return Object.entries(plugins).map(([name, config]) => {
    const current = installed.get(name)
    const desired = config.version
    if (current === undefined) return { name, action: 'install', desired }
    const installedVersion = current.version || current.committish.slice(0, 7) || undefined
    if (desired === undefined) return { name, action: 'ok', installed: installedVersion }
    // A sha pin is compared with the installed commit.
    if (SHA.test(desired) && current.committish) {
      if (current.committish.toLowerCase().startsWith(desired.toLowerCase())) {
        return { name, action: 'ok', installed: installedVersion, desired }
      }
    }
    if (!current.version) return { name, action: 'unknown', installed: installedVersion, desired }
    const cmp = compareVersions(current.version, desired)
    const action: PluginAction = cmp === undefined ? 'unknown' : cmp < 0 ? 'update' : cmp > 0 ? 'newer' : 'ok'
    return { name, action, installed: installedVersion, desired }
  })
}

export async function ensurePlugins(
  ctx: Context,
  plugins: Record<string, PluginConfig>
): Promise<void> {
  const plans = planPlugins(await ctx.queryStrict('plugin:list', '--format', 'json'), plugins)

  for (const plan of plans) {
    const config = plugins[plan.name]
    switch (plan.action) {
      case 'install':
        logAction('plugins', `Installing ${plan.name}`)
        await ctx.run('plugin:install', config.url,
          ...(config.version ? ['--committish', config.version] : []), '--name', plan.name)
        logDone()
        break
      case 'update':
        logAction('plugins', `Updating ${plan.name}`)
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
        break
    }
  }
}
