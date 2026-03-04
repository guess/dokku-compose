import type { Runner } from '../core/dokku.js'

export async function ensureAppRegistry(
  runner: Runner,
  app: string,
  registry: Record<string, string | boolean>
): Promise<void> {
  for (const [key, value] of Object.entries(registry)) {
    await runner.run('registry:set', app, key, String(value))
  }
}

export async function exportAppRegistry(
  runner: Runner,
  app: string
): Promise<Record<string, string> | undefined> {
  const raw = await runner.query('registry:report', app)
  if (!raw) return undefined
  return undefined  // simplified
}
