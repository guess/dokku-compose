import type { Context } from '../core/context.js'
import { logAction, logDone, logSkip } from '../core/logger.js'

export async function ensureAppNginx(
  ctx: Context,
  app: string,
  nginx: Record<string, string | number>
): Promise<void> {
  logAction(app, 'Configuring nginx')
  const current = await exportAppNginx(ctx, app) ?? {}
  let changed = false

  for (const [key, value] of Object.entries(nginx)) {
    if (String(value) === current[key]) continue
    await ctx.run('nginx:set', app, key, String(value))
    changed = true
  }

  if (changed) {
    await ctx.run('proxy:build-config', app)
    logDone()
  } else {
    logSkip()
  }
}

export async function ensureGlobalNginx(
  ctx: Context,
  nginx: Record<string, string | number>
): Promise<void> {
  for (const [key, value] of Object.entries(nginx)) {
    await ctx.run('nginx:set', '--global', key, String(value))
  }
}

export async function exportAppNginx(
  ctx: Context,
  app: string
): Promise<Record<string, string> | undefined> {
  const raw = await ctx.query('nginx:report', app)
  if (!raw) return undefined
  const result: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const match = line.match(/^\s*Nginx\s+(.+?):\s*(.+?)\s*$/)
    if (match) {
      const key = match[1].toLowerCase().replace(/\s+/g, '-')
      if (key.startsWith('computed-') || key.startsWith('global-') || key === 'last-visited-at') continue
      const value = match[2].trim()
      if (!value) continue
      result[key] = value
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}
