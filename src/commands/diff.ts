import type { Context } from '../core/context.js'
import type { Config, AppConfig } from '../core/schema.js'
import { computeChange, computeAdditiveChange } from '../core/change.js'
import { ALL_APP_RESOURCES } from '../resources/index.js'
import { maskSensitiveData } from '../core/mask.js'
import { planPlugins } from '../modules/plugins.js'
import { assertDokkuSupported, compareToFile } from '../modules/version.js'
import chalk from 'chalk'

type DiffStatus = 'in-sync' | 'changed' | 'missing' | 'extra' | 'unknown'

interface FeatureDiff {
  status: DiffStatus
  desired?: unknown
  current?: unknown
  note?: string
  /** Settings on the server that the file no longer declares (shown as `-`). */
  removed?: string[]
}

interface AppDiff {
  [feature: string]: FeatureDiff
}

interface DiffResult {
  apps: Record<string, AppDiff>
  services: Record<string, { status: DiffStatus }>
  plugins: Record<string, FeatureDiff>
  /** Set when the server's Dokku version differs from the file's `dokku.version`. */
  dokku?: { file: string; server: string }
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
 *  - desired object + current false -> missing
 *  - desired false + current true -> changed (should be removed)
 *  - current undefined (report was empty/unreadable) -> defer to the
 *    generic path so the unknown handling applies, same as any other
 *    resource whose read failed; `undefined` must never be coerced to
 *    "missing" here, or an installed cert reads back as absent.
 *  - anything else (both booleans) -> fall through to the normal comparison
 */
function diffSslStatus(desired: unknown, current: unknown): DiffStatus | undefined {
  if (typeof desired !== 'object' || desired === null) return undefined
  if (current === undefined) return undefined
  if (current === true) return 'in-sync'
  if (current === false || current === null) return 'missing'
  return undefined
}

/** Whether a change holds anything besides entries only on the server. */
function hasAdditionsOrChanges(change: object): boolean {
  const c = change as { changed: boolean; added?: unknown; modified?: Record<string, string> }
  if (c.added === undefined) return c.changed  // scalar change
  const added = Array.isArray(c.added) ? c.added.length : Object.keys(c.added as object).length
  return added > 0 || Object.keys(c.modified ?? {}).length > 0
}

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === 'object' && Object.keys(value as any).length === 0)
}

export async function computeDiff(ctx: Context, config: Config): Promise<DiffResult> {
  const result: DiffResult = { apps: {}, services: {}, plugins: {}, inSync: true, readWarnings: [] }
  const appNames = Object.keys(config.apps)

  const serverVersion = await assertDokkuSupported(ctx)
  const fileVersion = config.dokku?.version
  if (fileVersion && compareToFile(serverVersion, fileVersion) !== 'equal') {
    result.dokku = { file: fileVersion, server: serverVersion }
    result.inSync = false
  }

  // An app that does not exist on the server yet cannot have any of its
  // resources read — every resource report for it is naturally empty. That
  // is a normal first run, not a read failure, so this must be resolved
  // before the unreadable heuristic below (which only wants to see apps
  // that exist and still came back empty).
  const appExists = new Map<string, boolean>()
  await Promise.all(
    appNames.map(async app => {
      appExists.set(app, await ctx.check('apps:exists', app))
    })
  )
  const existingAppNames = appNames.filter(app => appExists.get(app))

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
          const unreadable = existingAppNames.length > 0 && bulk.size === 0
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

      // Map schema field to resource key
      let desired: unknown
      if (resource.key === 'proxy') {
        desired = appConfig.proxy?.enabled
      } else {
        desired = (appConfig as any)[resource.key]
      }
      // A block gone from the file can still leave settings on the box.
      const checkRemovalsOnly = desired === undefined
      if (checkRemovalsOnly && (!resource.removals || !appExists.get(app))) continue
      if (resource.forceApply && !resource.removals) continue  // can't diff forceApply resources

      // The app itself does not exist yet: every desired resource on it is
      // simply missing, never "unknown" — there is nothing unreadable about
      // an app that has not been created.
      if (!appExists.get(app)) {
        appDiff[resource.key] = { status: 'missing', desired, current: undefined }
        result.inSync = false
        continue
      }

      const bulk = prefetched.get(resource.key)
      let current: unknown
      let bulkUnreadable = false

      if (checkRemovalsOnly) {
        // Nothing is declared, so a failed read must not fail the whole diff.
        try {
          current = bulk ? bulk.get(app) : await resource.read(ctx, app)
          if (bulk === null || current === undefined) current = await resource.read(ctx, app)
        } catch (err) {
          result.readWarnings.push(`could not read '${resource.key}' for app '${app}' to look for removed settings: ${err instanceof Error ? err.message : String(err)}`)
          continue
        }
        const removed = resource.removals!(current as any, undefined)
        if (removed.length > 0) {
          appDiff[resource.key] = { status: 'extra', current, removed }
          result.inSync = false
        }
        continue
      }

      if (bulk === null) {
        bulkUnreadable = true
        current = await resource.read(ctx, app)
      } else if (bulk) {
        current = bulk.get(app)
        // `ssl`'s bulk report can be well-formed overall (readAll's
        // unreadable check passes) yet still miss the `enabled` key for one
        // app's section. That per-app gap must fall back to a direct read,
        // same as a fully-unreadable bulk report, rather than being coerced
        // into "missing".
        if (resource.key === 'ssl' && current === undefined) {
          current = await resource.read(ctx, app)
          if (current === undefined) bulkUnreadable = true
        }
      } else {
        current = await resource.read(ctx, app)
      }

      const sslStatus = resource.key === 'ssl' ? diffSslStatus(desired, current) : undefined

      if (sslStatus) {
        appDiff[resource.key] = { status: sslStatus, desired, current }
        if (sslStatus !== 'in-sync') result.inSync = false
        continue
      }

      let removed: string[] = resource.removals
        ? resource.removals(current as any, desired as any)
        : []

      if (resource.forceApply) {
        // Applied unconditionally, so only its removals can be diffed.
        if (removed.length > 0) {
          appDiff[resource.key] = { status: 'extra', desired, current, removed }
          result.inSync = false
        }
        continue
      }

      const change = resource.additive
        ? computeAdditiveChange(current, desired)
        : computeChange(current as any, desired as any)

      // Resources without a settings allowlist: list entries only on the server
      // (which `up` prunes within a declared block).
      if (!resource.removals && Array.isArray(current) && 'removed' in change) {
        removed = (change as { removed: string[] }).removed
      }
      if (!change.changed && removed.length === 0) {
        appDiff[resource.key] = { status: 'in-sync', desired, current }
      } else if (removed.length > 0 && !hasAdditionsOrChanges(change)) {
        // What the file declares matches; the box has more.
        appDiff[resource.key] = { status: 'extra', desired, current, removed }
        result.inSync = false
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
      if (removed.length > 0 && appDiff[resource.key].status !== 'extra') {
        appDiff[resource.key].removed = removed
      }
    }

    // `up` unlinks every service an app does not list under `links:`.
    if (appConfig.links === undefined && appExists.get(app)) {
      const linked: string[] = []
      for (const [plugin, services] of [['postgres', config.postgres], ['redis', config.redis]] as const) {
        for (const svc of Object.keys(services ?? {})) {
          if (await ctx.check(`${plugin}:linked`, svc, app)) linked.push(svc)
        }
      }
      if (linked.length > 0) {
        appDiff['links'] = { status: 'extra', current: linked, removed: linked, note: 'no links: in the file; up will unlink these' }
        result.inSync = false
      }
    }

    result.apps[app] = appDiff
  }

  // Compare plugin pins
  if (config.plugins) {
    const plans = planPlugins(await ctx.queryStrict('plugin:list', '--format', 'json'), config.plugins)
    for (const plan of plans) {
      if (plan.action === 'ok') continue
      const status: DiffStatus = plan.action === 'install' ? 'missing'
        : plan.action === 'unknown' ? 'unknown' : 'changed'
      const note = plan.action === 'newer' ? 'installed is newer; up warns and leaves it'
        : plan.action === 'unknown' ? 'versions cannot be compared; up leaves it'
        : undefined
      result.plugins[plan.name] = { status, desired: plan.desired, current: plan.installed, note }
      // An uncomparable pin is shown but is not drift: up leaves it, so it must not fail a check.
      if (plan.action !== 'unknown') result.inSync = false
    }
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
  const masked: DiffResult = { apps: {}, services: diff.services, plugins: diff.plugins, dokku: diff.dokku, inSync: diff.inSync, readWarnings: diff.readWarnings }
  for (const [app, appDiff] of Object.entries(diff.apps)) {
    const maskedAppDiff: AppDiff = {}
    for (const [feature, d] of Object.entries(appDiff)) {
      maskedAppDiff[feature] = {
        status: d.status,
        desired: maskSensitiveData(d.desired),
        current: maskSensitiveData(d.current),
        ...(d.removed ? { removed: d.removed } : {}),
        ...(d.note ? { note: d.note } : {}),
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
          : d.status === 'extra' ? chalk.red('-')
          : chalk.yellow('~')
        lines.push(`    ${sym} ${feature}: ${formatFeatureSummary(d)}`)
      }
    }
  }

  if (diff.dokku) {
    lines.push(`  dokku`)
    lines.push(`    ${chalk.yellow('~')} version: ${diff.dokku.file} (file) → ${diff.dokku.server} (server)`)
  }

  for (const [name, d] of Object.entries(diff.plugins)) {
    const sym = d.status === 'missing' ? chalk.green('+') : d.status === 'unknown' ? chalk.red('?') : chalk.yellow('~')
    const detail = d.status === 'missing' ? `not installed (want ${d.desired ?? 'any'})` : `${d.current} → ${d.desired}`
    lines.push(`  plugin: ${name}`)
    lines.push(`    ${sym} version: ${detail}${d.note ? ` (${d.note})` : ''}`)
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
    Object.values(diff.services).filter(d => d.status !== 'in-sync').length +
    Object.values(diff.plugins).filter(d => d.status !== 'unknown').length +
    (diff.dokku ? 1 : 0)

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
  const gone = d.removed?.length ? `not in the file: ${d.removed.join(', ')}` : ''
  if (d.status === 'extra') return `${gone}${d.note ? ` (${d.note})` : ''}`
  const base = formatChange(d)
  return gone ? `${base}; ${gone}` : base
}

function formatChange(d: FeatureDiff): string {
  if (d.status === 'unknown') return '(could not read server state — not reported as missing)'
  if (d.status === 'missing') return '(not set on server)'
  if (Array.isArray(d.desired) && Array.isArray(d.current)) {
    return `${(d.current as unknown[]).length} → ${(d.desired as unknown[]).length} items`
  }
  return `${JSON.stringify(d.current, showUnset)} → ${JSON.stringify(d.desired, showUnset)}`
}

// The env resource reads a marked key that is gone from the app as this sentinel.
function showUnset(_key: string, value: unknown): unknown {
  return value === '\u0000missing' ? '(unset)' : value
}

export function formatVerbose(diff: DiffResult): string {
  const lines: string[] = ['']

  for (const [app, appDiff] of Object.entries(diff.apps)) {
    const changes = Object.entries(appDiff).filter(([, d]) => d.status !== 'in-sync')
    if (changes.length === 0) continue

    for (const [feature, d] of changes) {
      lines.push(`@@ app: ${app} / ${feature} @@`)
      if (d.status === 'unknown') {
        // Not a +/- drift block — an unknown means the read failed, not
        // that the values differ, and must not look like a proposed change.
        lines.push(chalk.red(`  ? could not read server state — not reported as missing`))
        continue
      }
      if (d.status === 'extra') {
        for (const r of d.removed ?? []) lines.push(chalk.red(`- ${r}`))
        if (d.note) lines.push(`  (${d.note})`)
        continue
      }
      const currentLines = d.current !== undefined
        ? JSON.stringify(d.current, showUnset, 2).split('\n')
        : []
      const desiredLines = JSON.stringify(d.desired, showUnset, 2).split('\n')
      for (const line of currentLines) lines.push(chalk.red(`- ${line}`))
      for (const line of desiredLines) lines.push(chalk.green(`+ ${line}`))
      for (const r of d.removed ?? []) lines.push(chalk.red(`- ${r} (not in the file)`))
    }
  }

  if (diff.dokku) {
    lines.push(`@@ dokku version @@`)
    lines.push(chalk.red(`- ${diff.dokku.server} (server)`))
    lines.push(chalk.green(`+ ${diff.dokku.file} (file)`))
  }

  for (const [name, d] of Object.entries(diff.plugins)) {
    lines.push(`@@ plugin: ${name} @@`)
    if (d.current !== undefined) lines.push(chalk.red(`- ${d.current}`))
    lines.push(chalk.green(`+ ${d.desired ?? '(any version)'}`) + (d.note ? ` (${d.note})` : ''))
  }

  for (const [svc, d] of Object.entries(diff.services)) {
    if (d.status === 'missing') {
      lines.push(`@@ services @@`)
      lines.push(chalk.green(`+ ${svc}`))
    }
  }

  if (diff.readWarnings.length > 0) {
    lines.push('')
    lines.push(chalk.red('Could not read some server state — treated as unknown, not missing:'))
    for (const w of diff.readWarnings) lines.push(chalk.red(`  - ${w}`))
  }

  lines.push('')
  return lines.join('\n')
}
