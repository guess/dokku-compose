import type { Context } from '../core/context.js'
import type { Config } from '../core/schema.js'
import { destroyApp } from '../modules/apps.js'
import { destroyPostgres } from '../modules/postgres.js'
import { destroyRedis } from '../modules/redis.js'
import { destroyAppLinks } from '../modules/links.js'
import { logAction, logDone, logSkip } from '../core/logger.js'

export interface DownOptions {
  force: boolean
}

export async function runDown(
  ctx: Context,
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
    if (appConfig.links && (config.postgres || config.redis)) {
      await destroyAppLinks(ctx, app, appConfig.links, config)
    }

    // Destroy the app
    await destroyApp(ctx, app)
  }

  // Phase 2: Destroy services (if no remaining apps link to them)
  if (config.postgres) await destroyPostgres(ctx, config.postgres)
  if (config.redis) await destroyRedis(ctx, config.redis)

  // Phase 3: Destroy networks
  if (config.networks) {
    for (const net of config.networks) {
      logAction('network', `Destroying ${net}`)
      const exists = await ctx.check('network:exists', net)
      if (!exists) { logSkip(); continue }
      await ctx.run('network:destroy', net, '--force')
      logDone()
    }
  }
}
