import type { Runner } from '../core/dokku.js'
import { logAction, logDone, logSkip } from '../core/logger.js'

export async function ensureAppScheduler(
  runner: Runner,
  app: string,
  scheduler: string
): Promise<void> {
  logAction(app, `Setting scheduler to ${scheduler}`)
  const current = await runner.query('scheduler:report', app, '--scheduler-selected')
  if (current.trim() === scheduler) { logSkip(); return }
  await runner.run('scheduler:set', app, 'selected', scheduler)
  logDone()
}

export async function exportAppScheduler(
  runner: Runner,
  app: string
): Promise<string | undefined> {
  const raw = await runner.query('scheduler:report', app, '--scheduler-selected')
  const scheduler = raw.trim()
  if (!scheduler || scheduler === 'docker-local') return undefined  // default
  return scheduler
}
