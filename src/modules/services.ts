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

export async function exportServices(
  _ctx: Context
): Promise<Record<string, ServiceConfig>> {
  // This is a best-effort export — callers will typically provide known plugin names
  return {}
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
