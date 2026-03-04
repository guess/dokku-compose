import type { Runner } from '../core/dokku.js'
import { logAction, logDone, logSkip } from '../core/logger.js'

export async function ensureAppStorage(
  runner: Runner,
  app: string,
  storage: string[]
): Promise<void> {
  logAction(app, 'Configuring storage')
  const currentRaw = await runner.query('storage:report', app, '--storage-mounts')
  const current = currentRaw.split('\n').map(s => s.trim()).filter(Boolean)
  const desired = new Set(storage)
  const currentSet = new Set(current)

  const toUnmount = current.filter(m => !desired.has(m))
  const toMount = storage.filter(m => !currentSet.has(m))

  if (toUnmount.length === 0 && toMount.length === 0) { logSkip(); return }

  for (const mount of toUnmount) {
    await runner.run('storage:unmount', app, mount)
  }
  for (const mount of toMount) {
    await runner.run('storage:mount', app, mount)
  }
  logDone()
}

export async function exportAppStorage(
  runner: Runner,
  app: string
): Promise<string[] | undefined> {
  const raw = await runner.query('storage:report', app, '--storage-mounts')
  const mounts = raw.split('\n').map(s => s.trim()).filter(Boolean)
  if (mounts.length === 0) return undefined
  return mounts
}
