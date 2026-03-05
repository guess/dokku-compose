import { createHash } from 'crypto'
import type { Context } from '../core/context.js'
import type { PostgresConfig, ServiceBackupConfig } from '../core/schema.js'
import { logAction, logDone, logSkip } from '../core/logger.js'

function backupHashKey(serviceName: string): string {
  return 'DOKKU_COMPOSE_BACKUP_HASH_' + serviceName.toUpperCase().replace(/-/g, '_')
}

function computeBackupHash(backup: ServiceBackupConfig): string {
  return createHash('sha256').update(JSON.stringify(backup)).digest('hex')
}

export async function ensurePostgres(
  ctx: Context,
  services: Record<string, PostgresConfig>
): Promise<void> {
  for (const [name, config] of Object.entries(services)) {
    logAction('services', `Ensuring ${name}`)
    const exists = await ctx.check('postgres:exists', name)
    if (exists) { logSkip(); continue }
    const args: string[] = ['postgres:create', name]
    if (config.image) args.push('--image', config.image)
    if (config.version) args.push('--image-version', config.version)
    await ctx.run(...args)
    logDone()
  }
}

export async function ensurePostgresBackups(
  ctx: Context,
  services: Record<string, PostgresConfig>
): Promise<void> {
  for (const [name, config] of Object.entries(services)) {
    if (!config.backup) continue
    logAction('services', `Configuring backup for ${name}`)
    const hashKey = backupHashKey(name)
    const desiredHash = computeBackupHash(config.backup)
    const storedHash = await ctx.query('config:get', '--global', hashKey)
    if (storedHash === desiredHash) { logSkip(); continue }
    const { schedule, bucket, auth } = config.backup
    await ctx.run('postgres:backup-deauth', name)
    await ctx.run(
      'postgres:backup-auth', name,
      auth.access_key_id, auth.secret_access_key,
      auth.region, auth.signature_version, auth.endpoint
    )
    await ctx.run('postgres:backup-schedule', name, schedule, bucket)
    await ctx.run('config:set', '--global', `${hashKey}=${desiredHash}`)
    logDone()
  }
}

export async function destroyPostgres(
  ctx: Context,
  services: Record<string, PostgresConfig>
): Promise<void> {
  for (const [name] of Object.entries(services)) {
    logAction('services', `Destroying ${name}`)
    const exists = await ctx.check('postgres:exists', name)
    if (!exists) { logSkip(); continue }
    await ctx.run('postgres:destroy', name, '--force')
    logDone()
  }
}

function parseBackupSchedule(
  cronLine: string
): { schedule: string; bucket: string } | null {
  // Format: "0 * * * * dokku /usr/bin/dokku postgres:backup <name> <bucket>"
  const parts = cronLine.trim().split(/\s+/)
  if (parts.length < 8) return null
  const schedule = parts.slice(0, 5).join(' ')
  const bucket = parts[parts.length - 1]
  return { schedule, bucket }
}

export async function exportPostgres(
  ctx: Context
): Promise<Record<string, PostgresConfig>> {
  const services: Record<string, PostgresConfig> = {}
  const listOutput = await ctx.query('postgres:list')
  const lines = listOutput.split('\n').slice(1)

  for (const line of lines) {
    const name = line.trim().split(/\s+/)[0]
    if (!name) continue

    const infoOutput = await ctx.query('postgres:info', name)
    const versionMatch = infoOutput.match(/Version:\s+(\S+)/)
    if (!versionMatch) continue

    const versionField = versionMatch[1]
    const colonIdx = versionField.lastIndexOf(':')

    const config: PostgresConfig = {}
    if (colonIdx > 0) {
      const image = versionField.slice(0, colonIdx)
      const version = versionField.slice(colonIdx + 1)
      if (image !== 'postgres') config.image = image
      if (version) config.version = version
    } else {
      config.version = versionField
    }

    try {
      const cronOutput = await ctx.query('postgres:backup-schedule-cat', name)
      if (cronOutput) {
        const parsed = parseBackupSchedule(cronOutput)
        if (parsed) {
          config.backup = {
            schedule: parsed.schedule,
            bucket: parsed.bucket,
            auth: {
              access_key_id: 'REPLACE_ME',
              secret_access_key: 'REPLACE_ME',
              region: 'REPLACE_ME',
              signature_version: 'REPLACE_ME',
              endpoint: 'REPLACE_ME',
            },
          }
        }
      }
    } catch {
      // No backup configured for this service
    }

    services[name] = config
  }

  return services
}
