import type { Context } from '../core/context.js'
import type { Config } from '../core/schema.js'
import { logAction, logDone } from '../core/logger.js'

export function resolveServicePlugin(
  name: string,
  config: Config
): { plugin: string; config: Record<string, unknown> } | undefined {
  if (config.postgres?.[name]) return { plugin: 'postgres', config: config.postgres[name] }
  if (config.redis?.[name]) return { plugin: 'redis', config: config.redis[name] }
  return undefined
}

function allServices(config: Config): [string, string][] {
  const entries: [string, string][] = []
  for (const name of Object.keys(config.postgres ?? {})) entries.push([name, 'postgres'])
  for (const name of Object.keys(config.redis ?? {})) entries.push([name, 'redis'])
  return entries
}

export async function ensureAppLinks(
  ctx: Context,
  app: string,
  desiredLinks: string[],
  config: Config
): Promise<void> {
  const desiredSet = new Set(desiredLinks)
  for (const [serviceName, plugin] of allServices(config)) {
    const isLinked = await ctx.check(`${plugin}:linked`, serviceName, app)
    const isDesired = desiredSet.has(serviceName)
    if (isDesired && !isLinked) {
      logAction(app, `Linking ${serviceName}`)
      await ctx.run(`${plugin}:link`, serviceName, app, '--no-restart')
      logDone()
    } else if (!isDesired && isLinked) {
      logAction(app, `Unlinking ${serviceName}`)
      await ctx.run(`${plugin}:unlink`, serviceName, app, '--no-restart')
      logDone()
    }
  }
}

export async function destroyAppLinks(
  ctx: Context,
  app: string,
  links: string[],
  config: Config
): Promise<void> {
  for (const serviceName of links) {
    const resolved = resolveServicePlugin(serviceName, config)
    if (!resolved) continue
    const isLinked = await ctx.check(`${resolved.plugin}:linked`, serviceName, app)
    if (isLinked) {
      await ctx.run(`${resolved.plugin}:unlink`, serviceName, app, '--no-restart')
    }
  }
}

export async function exportAppLinks(
  ctx: Context,
  app: string,
  config: Config
): Promise<string[]> {
  const linked: string[] = []
  for (const [serviceName, plugin] of allServices(config)) {
    const isLinked = await ctx.check(`${plugin}:linked`, serviceName, app)
    if (isLinked) linked.push(serviceName)
  }
  return linked
}
