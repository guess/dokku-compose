import type { Runner } from '../core/dokku.js'
import { logAction, logDone } from '../core/logger.js'

export async function ensureAppDomains(
  runner: Runner,
  app: string,
  domains: string[] | false | undefined
): Promise<void> {
  if (domains === undefined) return
  logAction(app, 'Configuring domains')
  if (domains === false) {
    await runner.run('domains:disable', app)
    await runner.run('domains:clear', app)
  } else {
    await runner.run('domains:enable', app)
    await runner.run('domains:set', app, ...domains)
  }
  logDone()
}

export async function ensureGlobalDomains(
  runner: Runner,
  domains: string[] | false
): Promise<void> {
  logAction('global', 'Configuring domains')
  if (domains === false) {
    await runner.run('domains:clear-global')
  } else {
    await runner.run('domains:set-global', ...domains)
  }
  logDone()
}

export async function exportAppDomains(
  runner: Runner,
  app: string
): Promise<string[] | undefined> {
  const raw = await runner.query('domains:report', app, '--domains-app-vhosts')
  const vhosts = raw.split('\n').map(s => s.trim()).filter(Boolean)
  if (vhosts.length === 0) return undefined
  return vhosts
}
