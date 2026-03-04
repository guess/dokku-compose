import type { Config, AppConfig } from '../core/schema.js'
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

export function computeDiff(desired: Config, current: Config): DiffResult {
  const result: DiffResult = { apps: {}, services: {}, inSync: true }

  // Compare per-app features
  for (const [app, desiredApp] of Object.entries(desired.apps)) {
    const currentApp = current.apps[app] ?? {}
    const appDiff: AppDiff = {}

    const features: Array<keyof AppConfig> = [
      'domains', 'ports', 'env', 'ssl', 'storage',
      'nginx', 'logs', 'registry', 'scheduler', 'checks',
      'networks', 'proxy', 'links'
    ]

    for (const feature of features) {
      const d = desiredApp[feature]
      const c = currentApp[feature as keyof typeof currentApp]
      if (d === undefined) continue  // not declared = don't diff

      const dStr = JSON.stringify(d)
      const cStr = JSON.stringify(c)

      if (c === undefined) {
        appDiff[feature] = { status: 'missing', desired: d, current: undefined }
        result.inSync = false
      } else if (dStr !== cStr) {
        appDiff[feature] = { status: 'changed', desired: d, current: c }
        result.inSync = false
      } else {
        appDiff[feature] = { status: 'in-sync', desired: d, current: c }
      }
    }
    result.apps[app] = appDiff
  }

  // Compare services
  for (const [svc] of Object.entries(desired.services ?? {})) {
    const exists = current.services?.[svc]
    if (!exists) {
      result.services[svc] = { status: 'missing' }
      result.inSync = false
    } else {
      result.services[svc] = { status: 'in-sync' }
    }
  }

  return result
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
