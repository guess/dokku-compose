import type { Context } from '../core/context.js'
import { logAction, logDone, logSkip } from '../core/logger.js'

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

/**
 * The global vhosts, read from `domains:report --global --domains-global-vhosts`
 * (Dokku 0.38.31 prints them space-joined, `normalizeWhitespace` in
 * `plugins/domains/report.go`).
 */
export async function readGlobalDomains(ctx: Context): Promise<string[]> {
  const raw = await ctx.queryStrict('domains:report', '--global', '--domains-global-vhosts')
  return raw.split(/\s+/).filter(Boolean)
}

function sameSet(a: string[], b: string[]): boolean {
  const sa = new Set(a)
  const sb = new Set(b)
  return sa.size === sb.size && [...sa].every(x => sb.has(x))
}

export async function ensureGlobalDomains(
  ctx: Context,
  domains: string[] | false
): Promise<void> {
  logAction('global', 'Configuring domains')
  const current = await readGlobalDomains(ctx)
  if (domains === false) {
    if (current.length === 0) { logSkip(); return }
    await ctx.run('domains:clear-global')
  } else {
    if (sameSet(current, domains)) { logSkip(); return }
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
