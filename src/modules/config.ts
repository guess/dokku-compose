import type { Context } from '../core/context.js'
import { logAction, logDone, logSkip } from '../core/logger.js'

const MANAGED_KEYS_VAR = 'DOKKU_COMPOSE_MANAGED_KEYS'

export async function ensureAppConfig(
  ctx: Context,
  app: string,
  env: Record<string, string | number | boolean> | false
): Promise<void> {
  logAction(app, 'Configuring env vars')

  if (env === false) {
    logSkip()
    return
  }

  // 1. Read previously managed keys
  const prevManagedRaw = await ctx.query('config:get', app, MANAGED_KEYS_VAR)
  const prevManaged = prevManagedRaw.trim()
    ? prevManagedRaw.trim().split(',').filter(Boolean)
    : []

  // 2. Compute keys to unset (managed previously but not in current desired)
  const desiredKeys = Object.keys(env)
  const toUnset = prevManaged.filter(k => !desiredKeys.includes(k))

  // 3. Unset orphaned keys
  if (toUnset.length > 0) {
    await ctx.run('config:unset', '--no-restart', app, ...toUnset)
  }

  // 4. Set desired vars + update managed keys list
  const pairs = Object.entries(env).map(([k, v]) => `${k}=${v}`)
  const newManagedKeys = desiredKeys.join(',')
  await ctx.run(
    'config:set', '--no-restart', app,
    ...pairs,
    `${MANAGED_KEYS_VAR}=${newManagedKeys}`
  )

  logDone()
}

export async function ensureGlobalConfig(
  ctx: Context,
  env: Record<string, string | number | boolean> | false
): Promise<void> {
  if (env === false) return
  const pairs = Object.entries(env).map(([k, v]) => `${k}=${v}`)
  await ctx.run('config:set', '--global', ...pairs)
}

export async function exportAppConfig(
  ctx: Context,
  app: string
): Promise<Record<string, string> | undefined> {
  const raw = await ctx.query('config:export', app, '--format', 'shell')
  if (!raw) return undefined
  const result: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const match = line.match(/^export\s+(\w+)=['"]?(.*?)['"]?$/)
    if (match && match[1] !== MANAGED_KEYS_VAR) {
      result[match[1]] = match[2]
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}
