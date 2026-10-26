import type { Context } from '../core/context.js'
import { ensureGlobal, type GlobalOptions } from './global.js'

export async function ensureAppLogs(
  ctx: Context,
  app: string,
  logs: Record<string, string | number>
): Promise<void> {
  for (const [key, value] of Object.entries(logs)) {
    await ctx.run('logs:set', app, key, String(value))
  }
}

/** Sets the global logs settings whose server value differs; under `--prune` clears the ones the block dropped. */
export const ensureGlobalLogs = (ctx: Context, block: Record<string, string | number>, opts: GlobalOptions = {}): Promise<boolean> =>
  ensureGlobal(ctx, 'logs', block, opts)

export async function exportAppLogs(
  ctx: Context,
  app: string
): Promise<Record<string, string> | undefined> {
  const raw = await ctx.query('logs:report', app)
  if (!raw) return undefined
  return undefined  // simplified
}
