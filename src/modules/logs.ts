import type { Context } from '../core/context.js'
import { parseJsonReport } from '../resources/parsers.js'
import { logAction, logDone, logSkip } from '../core/logger.js'

export async function ensureAppLogs(
  ctx: Context,
  app: string,
  logs: Record<string, string | number>
): Promise<void> {
  for (const [key, value] of Object.entries(logs)) {
    await ctx.run('logs:set', app, key, String(value))
  }
}

/** Global logs settings from `logs:report --global --format json` (unredacted in json). */
export async function readGlobalLogs(ctx: Context): Promise<Record<string, string>> {
  return parseJsonReport(await ctx.queryStrict('logs:report', '--global', '--format', 'json'), 'global')
}

/** Sets only the global logs settings whose server value differs. */
export async function ensureGlobalLogs(
  ctx: Context,
  logs: Record<string, string | number>
): Promise<void> {
  logAction('global', 'Configuring logs')
  const current = await readGlobalLogs(ctx)
  let changed = false
  for (const [key, value] of Object.entries(logs)) {
    if (current[key] === String(value)) continue
    await ctx.run('logs:set', '--global', key, String(value))
    changed = true
  }
  if (changed) logDone()
  else logSkip()
}

export async function exportAppLogs(
  ctx: Context,
  app: string
): Promise<Record<string, string> | undefined> {
  const raw = await ctx.query('logs:report', app)
  if (!raw) return undefined
  return undefined  // simplified
}
