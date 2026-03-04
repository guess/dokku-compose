import type { Runner } from '../core/dokku.js'
import type { AppConfig } from '../core/schema.js'
import { logAction, logDone, logSkip } from '../core/logger.js'

type SslConfig = NonNullable<AppConfig['ssl']>

export async function ensureAppCerts(
  runner: Runner,
  app: string,
  ssl: SslConfig
): Promise<void> {
  logAction(app, 'Configuring SSL')
  const enabledRaw = await runner.query('certs:report', app, '--ssl-enabled')
  const enabled = enabledRaw.trim() === 'true'

  if (ssl === false) {
    if (!enabled) { logSkip(); return }
    await runner.run('certs:remove', app)
    logDone()
    return
  }

  if (ssl === true) {
    // Just a marker — can't add cert without file paths
    if (enabled) { logSkip(); return }
    logSkip() // can't enable without files
    return
  }

  // ssl is { certfile, keyfile }
  if (enabled) { logSkip(); return }
  await runner.run('certs:add', app, ssl.certfile, ssl.keyfile)
  logDone()
}

export async function exportAppCerts(
  runner: Runner,
  app: string
): Promise<true | false | undefined> {
  const raw = await runner.query('certs:report', app, '--ssl-enabled')
  const enabled = raw.trim() === 'true'
  if (!enabled) return undefined
  return true  // can't export cert files, just signal SSL is on
}
