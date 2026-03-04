import type { Runner } from '../core/dokku.js'
import { logAction, logDone, logSkip } from '../core/logger.js'

export async function ensureAppPorts(
  runner: Runner,
  app: string,
  ports: string[]
): Promise<void> {
  logAction(app, 'Configuring ports')
  const currentRaw = await runner.query('ports:report', app, '--ports-map')
  const current = currentRaw.split(/\s+/).map(s => s.trim()).filter(Boolean).sort()
  const desired = [...ports].sort()
  if (JSON.stringify(current) === JSON.stringify(desired)) { logSkip(); return }
  await runner.run('ports:set', app, ...ports)
  logDone()
}

export async function exportAppPorts(
  runner: Runner,
  app: string
): Promise<string[] | undefined> {
  const raw = await runner.query('ports:report', app, '--ports-map')
  const ports = raw.split(/\s+/).map(s => s.trim()).filter(Boolean)
  if (ports.length === 0) return undefined
  return ports
}
