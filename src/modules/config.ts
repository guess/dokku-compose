import { parseConfigJson } from '../core/config-json.js'
import type { Context } from '../core/context.js'

const MANAGED_KEYS_VAR = 'DOKKU_COMPOSE_MANAGED_KEYS'

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
  const raw = await ctx.queryStrict('config:export', '--format', 'json', app)
  const result = parseConfigJson(raw, app)
  delete result[MANAGED_KEYS_VAR]
  return Object.keys(result).length > 0 ? result : undefined
}
