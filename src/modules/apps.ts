import type { Runner } from '../core/dokku.js'
import { logAction, logDone, logSkip } from '../core/logger.js'

export async function ensureApp(runner: Runner, app: string): Promise<void> {
  const exists = await runner.check('apps:exists', app)
  logAction(app, 'Creating app')
  if (exists) { logSkip(); return }
  await runner.run('apps:create', app)
  logDone()
}

export async function destroyApp(runner: Runner, app: string): Promise<void> {
  const exists = await runner.check('apps:exists', app)
  logAction(app, 'Destroying app')
  if (!exists) { logSkip(); return }
  await runner.run('apps:destroy', app, '--force')
  logDone()
}

export async function exportApps(runner: Runner): Promise<string[]> {
  const output = await runner.query('apps:list')
  return output.split('\n').map(s => s.trim()).filter(Boolean)
}
