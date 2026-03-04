import type { Runner } from '../core/dokku.js'

export async function ensureAppLogs(
  runner: Runner,
  app: string,
  logs: Record<string, string | number>
): Promise<void> {
  for (const [key, value] of Object.entries(logs)) {
    await runner.run('logs:set', app, key, String(value))
  }
}

export async function ensureGlobalLogs(
  runner: Runner,
  logs: Record<string, string | number>
): Promise<void> {
  for (const [key, value] of Object.entries(logs)) {
    await runner.run('logs:set', '--global', key, String(value))
  }
}

export async function exportAppLogs(
  runner: Runner,
  app: string
): Promise<Record<string, string> | undefined> {
  const raw = await runner.query('logs:report', app)
  if (!raw) return undefined
  return undefined  // simplified
}
