import { createHash } from 'crypto'
import type { Context } from '../core/context.js'
import type { ServiceBackupConfig, ServiceConfig } from '../core/schema.js'
import { logAction, logDone, logSkip } from '../core/logger.js'

function backupHashKey(serviceName: string): string {
  return 'DOKKU_COMPOSE_BACKUP_HASH_' + serviceName.toUpperCase().replace(/-/g, '_')
}

function computeBackupHash(backup: ServiceBackupConfig): string {
  return createHash('sha256').update(JSON.stringify(backup)).digest('hex')
}

export async function ensureServices(
  ctx: Context,
  services: Record<string, ServiceConfig>
): Promise<void> {
  for (const [name, config] of Object.entries(services)) {
    logAction('services', `Ensuring ${name}`)
    const exists = await ctx.check(`${config.plugin}:exists`, name)
    if (exists) { logSkip(); continue }
    const args: string[] = [`${config.plugin}:create`, name]
    if (config.image) args.push('--image', config.image)
    if (config.version) args.push('--image-version', config.version)
    await ctx.run(...args)
    logDone()
  }
}

export async function ensureServiceBackups(
  ctx: Context,
  services: Record<string, ServiceConfig>
): Promise<void> {
  for (const [name, config] of Object.entries(services)) {
    if (!config.backup) continue
    logAction('services', `Configuring backup for ${name}`)
    const hashKey = backupHashKey(name)
    const desiredHash = computeBackupHash(config.backup)
    const storedHash = await ctx.query('config:get', '--global', hashKey)
    if (storedHash === desiredHash) { logSkip(); continue }
    const { schedule, bucket, auth } = config.backup
    await ctx.run(`${config.plugin}:backup-deauth`, name)
    await ctx.run(
      `${config.plugin}:backup-auth`, name,
      auth.access_key_id, auth.secret_access_key,
      auth.region, auth.signature_version, auth.endpoint
    )
    await ctx.run(`${config.plugin}:backup-schedule`, name, schedule, bucket)
    await ctx.run('config:set', '--global', `${hashKey}=${desiredHash}`)
    logDone()
  }
}

export async function ensureAppLinks(
  ctx: Context,
  app: string,
  desiredLinks: string[],
  allServices: Record<string, ServiceConfig>
): Promise<void> {
  const desiredSet = new Set(desiredLinks)

  for (const [serviceName, serviceConfig] of Object.entries(allServices)) {
    const isLinked = await ctx.check(`${serviceConfig.plugin}:linked`, serviceName, app)
    const isDesired = desiredSet.has(serviceName)

    if (isDesired && !isLinked) {
      logAction(app, `Linking ${serviceName}`)
      await ctx.run(`${serviceConfig.plugin}:link`, serviceName, app, '--no-restart')
      logDone()
    } else if (!isDesired && isLinked) {
      logAction(app, `Unlinking ${serviceName}`)
      await ctx.run(`${serviceConfig.plugin}:unlink`, serviceName, app, '--no-restart')
      logDone()
    }
  }
}

export async function destroyAppLinks(
  ctx: Context,
  app: string,
  links: string[],
  allServices: Record<string, ServiceConfig>
): Promise<void> {
  for (const serviceName of links) {
    const config = allServices[serviceName]
    if (!config) continue
    const isLinked = await ctx.check(`${config.plugin}:linked`, serviceName, app)
    if (isLinked) {
      await ctx.run(`${config.plugin}:unlink`, serviceName, app, '--no-restart')
    }
  }
}

export async function destroyServices(
  ctx: Context,
  services: Record<string, ServiceConfig>
): Promise<void> {
  for (const [name, config] of Object.entries(services)) {
    logAction('services', `Destroying ${name}`)
    const exists = await ctx.check(`${config.plugin}:exists`, name)
    if (!exists) { logSkip(); continue }
    await ctx.run(`${config.plugin}:destroy`, name, '--force')
    logDone()
  }
}

const SERVICE_PLUGINS = ['postgres', 'redis']

export async function exportServices(
  ctx: Context
): Promise<Record<string, ServiceConfig>> {
  const services: Record<string, ServiceConfig> = {}

  // Detect which service plugins are installed
  const pluginOutput = await ctx.query('plugin:list')
  const installedPlugins = new Set(
    pluginOutput.split('\n').map(line => line.trim().split(/\s+/)[0]).filter(Boolean)
  )

  for (const plugin of SERVICE_PLUGINS) {
    if (!installedPlugins.has(plugin)) continue

    // List services for this plugin
    const listOutput = await ctx.query(`${plugin}:list`)
    const lines = listOutput.split('\n').slice(1) // skip header

    for (const line of lines) {
      const name = line.trim().split(/\s+/)[0]
      if (!name) continue

      // Get version/image from info output
      const infoOutput = await ctx.query(`${plugin}:info`, name)
      const versionMatch = infoOutput.match(/Version:\s+(\S+)/)
      if (!versionMatch) continue

      const versionField = versionMatch[1]
      const colonIdx = versionField.lastIndexOf(':')

      const config: ServiceConfig = { plugin }
      if (colonIdx > 0) {
        const image = versionField.slice(0, colonIdx)
        const version = versionField.slice(colonIdx + 1)
        if (image !== plugin) config.image = image
        if (version) config.version = version
      } else {
        config.version = versionField
      }

      services[name] = config
    }
  }

  return services
}

export async function exportAppLinks(
  ctx: Context,
  app: string,
  services: Record<string, ServiceConfig>
): Promise<string[]> {
  const linked: string[] = []
  for (const [serviceName, config] of Object.entries(services)) {
    const isLinked = await ctx.check(`${config.plugin}:linked`, serviceName, app)
    if (isLinked) linked.push(serviceName)
  }
  return linked
}
