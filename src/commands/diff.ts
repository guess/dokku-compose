import type { Context } from '../core/context.js'
import type { Config, AppConfig } from '../core/schema.js'
import { computeChange } from '../core/change.js'
import { ALL_APP_RESOURCES } from '../resources/index.js'
import { maskSensitiveData } from '../core/mask.js'
import chalk from 'chalk'

type DiffStatus = 'in-sync' | 'changed' | 'missing' | 'extra'

interface FeatureDiff {
  status: DiffStatus
  desired?: unknown
  current?: unknown
}

interface AppDiff {
  [feature: string]: FeatureDiff
}

interface DiffResult {
  apps: Record<string, AppDiff>
  services: Record<string, { status: DiffStatus }>
  inSync: boolean
}

export async function computeDiff(ctx: Context, config: Config): Promise<DiffResult> {
  const result: DiffResult = { apps: {}, services: {}, inSync: true }

  // Bulk prefetch: run all readAll queries in parallel
  const prefetched = new Map<string, Map<string, unknown>>()
  await Promise.all(
    ALL_APP_RESOURCES
      .filter(r => !r.forceApply && !r.key.startsWith('_') && r.readAll)
      .map(async r => {
        prefetched.set(r.key, await r.readAll!(ctx))
      })
  )

  for (const [app, appConfig] of Object.entries(config.apps)) {
    const appDiff: AppDiff = {}

    for (const resource of ALL_APP_RESOURCES) {
      if (resource.key.startsWith('_')) continue
      if (resource.forceApply) continue  // can't diff forceApply resources

      // Map schema field to resource key
      let desired: unknown
      if (resource.key === 'proxy') {
        desired = appConfig.proxy?.enabled
      } else {
        desired = (appConfig as any)[resource.key]
      }
      if (desired === undefined) continue

      const bulk = prefetched.get(resource.key)
      const current = bulk ? bulk.get(app) : await resource.read(ctx, app)
      const change = computeChange(current as any, desired as any)

      if (!change.changed) {
        appDiff[resource.key] = { status: 'in-sync', desired, current }
      } else if (current === null || current === undefined ||
                 (Array.isArray(current) && current.length === 0) ||
                 (typeof current === 'object' && Object.keys(current as any).length === 0)) {
        appDiff[resource.key] = { status: 'missing', desired, current }
        result.inSync = false
      } else {
        appDiff[resource.key] = { status: 'changed', desired, current }
        result.inSync = false
      }
    }

    result.apps[app] = appDiff
  }

  // Compare services
  for (const svc of Object.keys(config.postgres ?? {})) {
    const exists = await ctx.check('postgres:exists', svc)
    result.services[svc] = { status: exists ? 'in-sync' : 'missing' }
    if (!exists) result.inSync = false
  }
  for (const svc of Object.keys(config.redis ?? {})) {
    const exists = await ctx.check('redis:exists', svc)
    result.services[svc] = { status: exists ? 'in-sync' : 'missing' }
    if (!exists) result.inSync = false
  }

  return result
}

export function maskDiffResult(diff: DiffResult): DiffResult {
  const masked: DiffResult = { apps: {}, services: diff.services, inSync: diff.inSync }
  for (const [app, appDiff] of Object.entries(diff.apps)) {
    const maskedAppDiff: AppDiff = {}
    for (const [feature, d] of Object.entries(appDiff)) {
      maskedAppDiff[feature] = {
        status: d.status,
        desired: maskSensitiveData(d.desired),
        current: maskSensitiveData(d.current),
      }
    }
    masked.apps[app] = maskedAppDiff
  }
  return masked
}

export function formatSummary(diff: DiffResult): string {
  const lines: string[] = ['']

  for (const [app, appDiff] of Object.entries(diff.apps)) {
    const changes = Object.entries(appDiff).filter(([, d]) => d.status !== 'in-sync')
    if (changes.length === 0) {
      lines.push(`  app: ${app}`)
      lines.push(`    (in sync)`)
    } else {
      lines.push(`  app: ${chalk.bold(app)}`)
      for (const [feature, d] of changes) {
        const sym = d.status === 'missing' ? chalk.green('+') : chalk.yellow('~')
        lines.push(`    ${sym} ${feature}: ${formatFeatureSummary(d)}`)
      }
    }
  }

  for (const [svc, d] of Object.entries(diff.services)) {
    if (d.status === 'missing') {
      lines.push(`  services:`)
      lines.push(`    ${chalk.green('+')} ${svc}: not provisioned`)
    }
  }

  const total = Object.values(diff.apps)
    .flatMap(a => Object.values(a))
    .filter(d => d.status !== 'in-sync').length +
    Object.values(diff.services).filter(d => d.status !== 'in-sync').length

  lines.push('')
  if (total === 0) {
    lines.push(chalk.green('  Everything in sync.'))
  } else {
    lines.push(chalk.yellow(`  ${total} resource(s) out of sync.`))
  }
  lines.push('')
  return lines.join('\n')
}

function formatFeatureSummary(d: FeatureDiff): string {
  if (d.status === 'missing') return '(not set on server)'
  if (Array.isArray(d.desired) && Array.isArray(d.current)) {
    return `${(d.current as unknown[]).length} → ${(d.desired as unknown[]).length} items`
  }
  return `${JSON.stringify(d.current)} → ${JSON.stringify(d.desired)}`
}

export function formatVerbose(diff: DiffResult): string {
  const lines: string[] = ['']

  for (const [app, appDiff] of Object.entries(diff.apps)) {
    const changes = Object.entries(appDiff).filter(([, d]) => d.status !== 'in-sync')
    if (changes.length === 0) continue

    for (const [feature, d] of changes) {
      lines.push(`@@ app: ${app} / ${feature} @@`)
      const currentLines = d.current !== undefined
        ? JSON.stringify(d.current, null, 2).split('\n')
        : []
      const desiredLines = JSON.stringify(d.desired, null, 2).split('\n')
      for (const line of currentLines) lines.push(chalk.red(`- ${line}`))
      for (const line of desiredLines) lines.push(chalk.green(`+ ${line}`))
    }
  }

  for (const [svc, d] of Object.entries(diff.services)) {
    if (d.status === 'missing') {
      lines.push(`@@ services @@`)
      lines.push(chalk.green(`+ ${svc}`))
    }
  }

  lines.push('')
  return lines.join('\n')
}
