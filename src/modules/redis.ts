import type { Context } from '../core/context.js'
import type { RedisConfig } from '../core/schema.js'
import { logAction, logDone, logSkip, logWarn } from '../core/logger.js'
import { readServiceMismatches } from './service-drift.js'
import { exportServiceBackup } from './service-backup.js'

export async function ensureRedis(
  ctx: Context,
  services: Record<string, RedisConfig>
): Promise<Set<string>> {
  const created = new Set<string>()
  for (const [name, config] of Object.entries(services)) {
    logAction('services', `Ensuring ${name}`)
    const exists = await ctx.check('redis:exists', name)
    if (exists) {
      logSkip()
      // Changing a service's version or image can need a dump and downtime, so
      // `up` only warns; run `redis:upgrade` yourself.
      try {
        const mismatches = await readServiceMismatches(ctx, 'redis', name, config)
        if (mismatches.length > 0) {
          const parts = mismatches.map(m => `${m.field} is ${m.current || '(unknown)'} on the server but ${m.desired} in the file`)
          logWarn('services', `${name}: ${parts.join('; ')}; up does not change it`)
        }
      } catch (err) {
        logWarn('services', `${name}: could not compare version and image: ${err instanceof Error ? err.message : String(err)}`)
      }
      continue
    }
    const args: string[] = ['redis:create', name]
    if (config.image) args.push('--image', config.image)
    if (config.version) args.push('--image-version', config.version)
    await ctx.run(...args)
    created.add(name)
    logDone()
  }
  return created
}

export async function destroyRedis(
  ctx: Context,
  services: Record<string, RedisConfig>
): Promise<void> {
  for (const [name] of Object.entries(services)) {
    logAction('services', `Destroying ${name}`)
    const exists = await ctx.check('redis:exists', name)
    if (!exists) { logSkip(); continue }
    await ctx.run('redis:destroy', name, '--force')
    logDone()
  }
}

export async function exportRedis(
  ctx: Context
): Promise<Record<string, RedisConfig>> {
  const services: Record<string, RedisConfig> = {}
  const listOutput = await ctx.query('redis:list')
  const lines = listOutput.split('\n').slice(1)

  for (const line of lines) {
    const name = line.trim().split(/\s+/)[0]
    if (!name) continue

    const infoOutput = await ctx.query('redis:info', name)
    const versionMatch = infoOutput.match(/Version:\s+(\S+)/)
    if (!versionMatch) continue

    const versionField = versionMatch[1]
    const colonIdx = versionField.lastIndexOf(':')

    const config: RedisConfig = {}
    if (colonIdx > 0) {
      const image = versionField.slice(0, colonIdx)
      const version = versionField.slice(colonIdx + 1)
      if (image !== 'redis') config.image = image
      if (version) config.version = version
    } else {
      config.version = versionField
    }

    const backup = await exportServiceBackup(ctx, 'redis', name)
    if (backup) config.backup = backup

    services[name] = config
  }

  return services
}
