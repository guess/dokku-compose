import type { Runner } from '../core/dokku.js'
import type { Config } from '../core/schema.js'
import { destroyApp } from '../modules/apps.js'
import { destroyAppLinks, destroyServices } from '../modules/services.js'
import { logAction, logDone, logSkip } from '../core/logger.js'

export interface DownOptions {
  force: boolean
}

export async function runDown(
  runner: Runner,
  config: Config,
  appFilter: string[],
  opts: DownOptions
): Promise<void> {
  const apps = appFilter.length > 0
    ? appFilter
    : Object.keys(config.apps)

  // Phase 1: Per-app teardown
  for (const app of apps) {
    const appConfig = config.apps[app]
    if (!appConfig) continue

    // Unlink services first
    if (config.services && appConfig.links) {
      await destroyAppLinks(runner, app, appConfig.links, config.services)
    }

    // Destroy the app
    await destroyApp(runner, app)
  }

  // Phase 2: Destroy services (if no remaining apps link to them)
  if (config.services) {
    await destroyServices(runner, config.services)
  }

  // Phase 3: Destroy networks
  if (config.networks) {
    for (const net of config.networks) {
      logAction('network', `Destroying ${net}`)
      const exists = await runner.check('network:exists', net)
      if (!exists) { logSkip(); continue }
      await runner.run('network:destroy', net, '--force')
      logDone()
    }
  }
}
