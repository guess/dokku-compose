import type { Runner } from '../core/dokku.js'
import type { AppConfig } from '../core/schema.js'
import { logAction, logDone } from '../core/logger.js'

type ChecksConfig = NonNullable<AppConfig['checks']>

export async function ensureAppChecks(
  runner: Runner,
  app: string,
  checks: ChecksConfig
): Promise<void> {
  logAction(app, 'Configuring checks')
  if (checks === false) {
    await runner.run('checks:disable', app)
    logDone()
    return
  }
  // checks is an object
  if (checks.disabled && checks.disabled.length > 0) {
    await runner.run('checks:disable', app, ...checks.disabled)
  }
  if (checks.skipped && checks.skipped.length > 0) {
    await runner.run('checks:skip', app, ...checks.skipped)
  }
  // Set any other check properties (wait-to-retire, attempts, etc.)
  for (const [key, value] of Object.entries(checks)) {
    if (key === 'disabled' || key === 'skipped') continue
    await runner.run('checks:set', app, key, String(value))
  }
  logDone()
}

export async function exportAppChecks(
  runner: Runner,
  app: string
): Promise<ChecksConfig | undefined> {
  const raw = await runner.query('checks:report', app)
  if (!raw) return undefined
  return undefined  // simplified — full parsing left for future
}
