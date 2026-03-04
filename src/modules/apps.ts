import type { Context } from '../core/context.js'
import { logAction, logDone, logSkip } from '../core/logger.js'

export async function ensureApp(ctx: Context, app: string): Promise<void> {
  const exists = await ctx.check('apps:exists', app)
  logAction(app, 'Creating app')
  if (exists) { logSkip(); return }
  await ctx.run('apps:create', app)
  logDone()
}

export async function destroyApp(ctx: Context, app: string): Promise<void> {
  const exists = await ctx.check('apps:exists', app)
  logAction(app, 'Destroying app')
  if (!exists) { logSkip(); return }
  await ctx.run('apps:destroy', app, '--force')
  logDone()
}

export async function exportApps(ctx: Context): Promise<string[]> {
  const output = await ctx.query('apps:list')
  return output.split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('=====>')
  )
}
