import type { Context } from '../core/context.js'

export async function ensureAppLogs(
  ctx: Context,
  app: string,
  logs: Record<string, string | number>
): Promise<void> {
  for (const [key, value] of Object.entries(logs)) {
    await ctx.run('logs:set', app, key, String(value))
  }
}

export async function ensureGlobalLogs(
  ctx: Context,
  logs: Record<string, string | number>
): Promise<void> {
  for (const [key, value] of Object.entries(logs)) {
    await ctx.run('logs:set', '--global', key, String(value))
  }
}

export async function exportAppLogs(
  ctx: Context,
  app: string
): Promise<Record<string, string> | undefined> {
  const raw = await ctx.query('logs:report', app)
  if (!raw) return undefined
  return undefined  // simplified
}
