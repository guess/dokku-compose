import type { Context } from '../core/context.js'
import { logAction, logDone } from '../core/logger.js'

export async function ensureAppDomains(
  ctx: Context,
  app: string,
  domains: string[] | false | undefined
): Promise<void> {
  if (domains === undefined) return
  logAction(app, 'Configuring domains')
  if (domains === false) {
    await ctx.run('domains:disable', app)
    await ctx.run('domains:clear', app)
  } else {
    await ctx.run('domains:enable', app)
    await ctx.run('domains:set', app, ...domains)
  }
  logDone()
}

export async function ensureGlobalDomains(
  ctx: Context,
  domains: string[] | false
): Promise<void> {
  logAction('global', 'Configuring domains')
  if (domains === false) {
    await ctx.run('domains:clear-global')
  } else {
    await ctx.run('domains:set-global', ...domains)
  }
  logDone()
}

export async function exportAppDomains(
  ctx: Context,
  app: string
): Promise<string[] | false | undefined> {
  const enabledRaw = await ctx.query('domains:report', app, '--domains-app-enabled')
  if (enabledRaw.trim() === 'false') return false
  const raw = await ctx.query('domains:report', app, '--domains-app-vhosts')
  const vhosts = raw.split('\n').map(s => s.trim()).filter(Boolean)
  if (vhosts.length === 0) return undefined
  return vhosts
}
