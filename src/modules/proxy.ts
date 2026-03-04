import type { Runner } from '../core/dokku.js'
import { logAction, logDone, logSkip } from '../core/logger.js'

export async function ensureAppProxy(
  runner: Runner,
  app: string,
  enabled: boolean
): Promise<void> {
  logAction(app, `Setting proxy enabled=${enabled}`)
  const currentRaw = await runner.query('proxy:report', app, '--proxy-enabled')
  const current = currentRaw.trim() === 'true'
  if (current === enabled) { logSkip(); return }
  if (enabled) {
    await runner.run('proxy:enable', app)
  } else {
    await runner.run('proxy:disable', app)
  }
  logDone()
}

export async function exportAppProxy(
  runner: Runner,
  app: string
): Promise<{ enabled: boolean } | undefined> {
  const raw = await runner.query('proxy:report', app, '--proxy-enabled')
  const enabled = raw.trim() === 'true'
  // Default is enabled=true, omit from export if default
  if (enabled) return undefined
  return { enabled }
}
