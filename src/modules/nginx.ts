import type { Runner } from '../core/dokku.js'
import { logAction, logDone, logSkip } from '../core/logger.js'

export async function ensureAppNginx(
  runner: Runner,
  app: string,
  nginx: Record<string, string | number>
): Promise<void> {
  for (const [key, value] of Object.entries(nginx)) {
    await runner.run('nginx:set', app, key, String(value))
  }
}

export async function ensureGlobalNginx(
  runner: Runner,
  nginx: Record<string, string | number>
): Promise<void> {
  for (const [key, value] of Object.entries(nginx)) {
    await runner.run('nginx:set', '--global', key, String(value))
  }
}

export async function exportAppNginx(
  runner: Runner,
  app: string
): Promise<Record<string, string> | undefined> {
  const raw = await runner.query('nginx:report', app)
  if (!raw) return undefined
  const result: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const match = line.match(/^\s*Nginx\s+(.+?):\s*(.+?)\s*$/)
    if (match) {
      const key = match[1].toLowerCase().replace(/\s+/g, '-')
      if (key.startsWith('computed-') || key.startsWith('global-') || key === 'last-visited-at') continue
      const value = match[2].trim()
      if (!value) continue
      result[key] = value
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}
