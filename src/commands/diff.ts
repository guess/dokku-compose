import type { Context } from '../core/context.js'
import type { Config, AppConfig } from '../core/schema.js'
import { computeChange } from '../core/change.js'
import { ALL_APP_RESOURCES } from '../resources/index.js'
import { maskSensitiveData } from '../core/mask.js'
import { ensureDokkuVersion } from '../modules/version.js'
import chalk from 'chalk'

type DiffStatus = 'in-sync' | 'changed' | 'missing' | 'extra' | 'unknown'

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
  /** Bulk or per-app reads that could not be trusted; diff falls back but flags them. */
  readWarnings: string[]
}

/**
 * `ssl` is special: the current value from certs:report is only ever a
 * boolean (cert present or not), while desired can be an object
 * ({certfile, keyfile}) or a boolean. A plain computeChange() would compare
 * `true` against `{certfile, keyfile}` as unequal scalars and report
 * "changed" on every run even when the cert is already in place. Treat:
 *  - desired object + current true  -> in-sync (a cert is present)
 *  - desired object + current false/absent -> missing
 *  - desired false + current true -> changed (should be removed)
 *  - anything else (both booleans) -> fall through to the normal comparison
 */
function diffSslStatus(desired: unknown, current: unknown): DiffStatus | undefined {
  if (typeof desired !== 'object' || desired === null) return undefined
  if (current === true) return 'in-sync'
  if (current === false || current === undefined || current === null) return 'missing'
  return undefined
}

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === 'object' && Object.keys(value as any).length === 0)
}

export async function computeDiff(ctx: Context, config: Config): Promise<DiffResult> {
  const result: DiffResult = { apps: {}, services: {}, inSync: true, readWarnings: [] }
  const appNames = Object.keys(config.apps)

  await ensureDokkuVersion(ctx, config.dokku?.version)

  // Bulk prefetch: run all readAll queries in parallel. A resource whose
  // bulk report comes back with zero parseable app sections, despite apps
  // existing, means the read itself failed (e.g. a Dokku bash-plugin report
  // command that silently produced no output) — not that every app is
  // missing that resource. Treat that as "unreadable" rather than trusting
  // an empty map, and fall back to a per-app read below.
  const prefetched = new Map<string, Map<string, unknown> | null>()
  await Promise.all(
    ALL_APP_RESOURCES
      .filter(r => !r.forceApply && !r.key.startsWith('_') && r.readAll)
      .map(async r => {
        try {
          const bulk = await r.readAll!(ctx)
          const unreadable = appNames.length > 0 && bulk.size === 0
          prefetched.set(r.key, unreadable ? null : bulk)
        } catch {
          prefetched.set(r.key, null)
        }
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
      let current: unknown
      let bulkUnreadable = false

      if (bulk === null) {
        bulkUnreadable = true
        current = await resource.read(ctx, app)
      } else if (bulk) {
        current = bulk.get(app)
      } else {
        current = await resource.read(ctx, app)
      }

      const sslStatus = resource.key === 'ssl' ? diffSslStatus(desired, current) : undefined

      if (sslStatus) {
        appDiff[resource.key] = { status: sslStatus, desired, current }
        if (sslStatus !== 'in-sync') result.inSync = false
        continue
      }

      const change = computeChange(current as any, desired as any)

      if (!change.changed) {
        appDiff[resource.key] = { status: 'in-sync', desired, current }
      } else if (bulkUnreadable && isEmptyValue(current)) {
        // The bulk report failed AND the per-app fallback also came back
        // empty — we cannot tell "genuinely unset" from "read failed" here,
        // so refuse to call it missing.
        appDiff[resource.key] = { status: 'unknown', desired, current }
        result.inSync = false
        const msg = `could not read '${resource.key}' for app '${app}' (bulk report was empty and the per-app read returned nothing)`
        result.readWarnings.push(msg)
      } else if (isEmptyValue(current)) {
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
  const masked: DiffResult = { apps: {}, services: diff.services, inSync: diff.inSync, readWarnings: diff.readWarnings }
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
        const sym = d.status === 'missing' ? chalk.green('+')
          : d.status === 'unknown' ? chalk.red('?')
          : chalk.yellow('~')
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

  if (diff.readWarnings.length > 0) {
    lines.push('')
    lines.push(chalk.red('  Could not read some server state — treated as unknown, not missing:'))
    for (const w of diff.readWarnings) lines.push(chalk.red(`    - ${w}`))
  }

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
  if (d.status === 'unknown') return '(could not read server state — not reported as missing)'
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
