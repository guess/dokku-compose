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
