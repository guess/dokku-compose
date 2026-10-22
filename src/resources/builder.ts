import type { Resource } from '../core/reconcile.js'
import type { Context } from '../core/context.js'
import { parseReport } from './parsers.js'
import { computeAdditiveChange } from '../core/change.js'
import { logWarn } from '../core/logger.js'
import { shellSplit, quoteShellArg } from '../core/shellwords.js'

/** Every `builder:set` key we set (Dokku 0.38.31 `plugins/builder/builder.go`; `detected` is read-only). */
export const BUILDER_KEYS = ['build-dir', 'selected', 'skip-cleanup'] as const

type BuildConfig = {
  dockerfile?: string
  app_json?: string
  context?: string
  selected?: string
  skip_cleanup?: string | boolean
  args?: Record<string, string>
}

type BuildOption = { key: string; value: string; raw: string }

/**
 * The `--build-arg` options among the stored build docker options. Each entry
 * of `build-list` is one option as Dokku stored it: shell-quoted, so the
 * KEY=VALUE word is unquoted here. `raw` is the stored text, which
 * `docker-options:remove` matches word by word.
 */
function parseBuildOptions(buildList: string[]): BuildOption[] {
  const out: BuildOption[] = []
  for (const raw of buildList) {
    const words = shellSplit(raw) ?? raw.trim().split(/\s+/)
    if (words[0] !== '--build-arg' || words.length < 2) continue
    const m = words.slice(1).join(' ').match(/^([^=\s]+)=?(.*)$/s)
    if (m) out.push({ key: m[1], value: m[2], raw })
  }
  return out
}

function parseBuildArgs(buildList: string[]): Record<string, string> {
  const args: Record<string, string> = {}
  // The last stored option wins, as it does for Docker.
  for (const o of parseBuildOptions(buildList)) args[o.key] = o.value
  return args
}

/** `build-list` from one app's `docker-options:report --format json`. */
async function readBuildList(ctx: Context, target: string): Promise<string[]> {
  const raw = await ctx.query('docker-options:report', target, '--format', 'json')
  // Empty output is a lenient read that found nothing; the version gate keeps older servers out.
  if (!raw.trim()) return []
  let report: unknown
  try { report = JSON.parse(raw) } catch { report = undefined }
  const list = (report as { 'build-list'?: unknown } | undefined)?.['build-list']
  if (!Array.isArray(list)) throw new Error(`docker-options:report ${target} --format json did not return a build-list (needs Dokku >= 0.38.22)`)
  return list.map(String)
}

function buildConfigFromReports(
  builderReport: Record<string, string>,
  dockerfileReport: Record<string, string>,
  appJsonReport: Record<string, string>,
  buildList: string[]
): BuildConfig {
  const config: BuildConfig = {}

  if (dockerfileReport['dockerfile-path'])
    config.dockerfile = dockerfileReport['dockerfile-path']
  if (appJsonReport['selected'])
    config.app_json = appJsonReport['selected']
  if (builderReport['build-dir'])
    config.context = builderReport['build-dir']
  if (builderReport['selected'])
    config.selected = builderReport['selected']
  if (builderReport['skip-cleanup'])
    config.skip_cleanup = builderReport['skip-cleanup']

  const args = parseBuildArgs(buildList)
  if (Object.keys(args).length > 0) config.args = args
  // Keys stored more than once (older versions appended duplicates). Not enumerable, so export never writes it.
  const seen = new Set<string>()
  const duplicated = new Set<string>()
  for (const o of parseBuildOptions(buildList)) (seen.has(o.key) ? duplicated : seen).add(o.key)
  Object.defineProperty(config, 'duplicateArgs', { value: duplicated, enumerable: false })

  return config
}

export const Builder: Resource<BuildConfig> = {
  key: 'build',
  additive: true,
  // Additive compare, plus: a declared arg stored more than once is drift until one option is left.
  inSync: (current, desired) =>
    !computeAdditiveChange(current, desired).changed &&
    !Object.keys(desired.args ?? {}).some(k => (current as any)?.duplicateArgs?.has(k)),
  // `builder:set` keys and build args (`--build-arg KEY=...` build docker options) not in the file.
  removals: (current, desired) => [
    ...(['selected', 'skip_cleanup'] as const).filter(k => current?.[k] !== undefined && desired?.[k] === undefined),
    ...Object.keys(current?.args ?? {})
      .filter(k => !(desired?.args && k in desired.args))
      .map(k => `args.${k}`),
  ],
  // Reset the stale `builder:set` keys; remove exactly the stale `--build-arg` options, other build options stay.
  prune: async (ctx, target, removed) => {
    for (const key of removed.filter(l => !l.startsWith('args.'))) {
      await ctx.run('builder:set', target, key.replaceAll('_', '-'))
      ctx.needsRebuild(target, 'build')
    }
    const stale = new Set(removed.filter(l => l.startsWith('args.')).map(l => l.slice('args.'.length)))
    if (stale.size === 0) return
    // Same query `read` made, so this is the cached report. Remove every stale occurrence, by exact option text.
    const options = parseBuildOptions(await readBuildList(ctx, target)).filter(o => stale.has(o.key))
    for (const o of options) {
      await ctx.run('docker-options:remove', target, 'build', o.raw)
      ctx.needsRebuild(target, 'build args')
    }
    for (const k of stale) {
      if (!options.some(o => o.key === k)) logWarn(target, `build arg '${k}' not found as an exact docker option; left as is`)
    }
  },

  async read(ctx: Context, target: string): Promise<BuildConfig> {
    const [builderRaw, dockerfileRaw, appJsonRaw, buildList] = await Promise.all([
      ctx.query('builder:report', target),
      ctx.query('builder-dockerfile:report', target),
      ctx.query('app-json:report', target),
      readBuildList(ctx, target),
    ])
    return buildConfigFromReports(
      parseReport(builderRaw, 'builder'),
      parseReport(dockerfileRaw, 'builder-dockerfile'),
      parseReport(appJsonRaw, 'app-json'),
      buildList
    )
  },

  async onChange(ctx: Context, target: string, { before, after }: { before?: BuildConfig; after: BuildConfig }): Promise<void> {
    if (after.dockerfile && after.dockerfile !== before?.dockerfile)
      { await ctx.run('builder-dockerfile:set', target, 'dockerfile-path', after.dockerfile); ctx.needsRebuild(target, 'build') }
    if (after.app_json && after.app_json !== before?.app_json)
      { await ctx.run('app-json:set', target, 'appjson-path', after.app_json); ctx.needsRebuild(target, 'build') }
    if (after.context && after.context !== before?.context)
      { await ctx.run('builder:set', target, 'build-dir', after.context); ctx.needsRebuild(target, 'build') }
    if (after.selected && after.selected !== before?.selected)
      { await ctx.run('builder:set', target, 'selected', after.selected); ctx.needsRebuild(target, 'build') }
    if (after.skip_cleanup !== undefined && String(after.skip_cleanup) !== String(before?.skip_cleanup))
      await ctx.run('builder:set', target, 'skip-cleanup', String(after.skip_cleanup))
    if (after.args) {
      // Only what differs: an unchanged arg runs nothing, a changed one first
      // removes every stored option for its key (by exact stored text; `add`
      // appends without dedupe), then adds the new value.
      const stored = parseBuildOptions(await readBuildList(ctx, target))
      const current = parseBuildArgs(stored.map(o => o.raw))
      const dup = (before as any)?.duplicateArgs as Set<string> | undefined
      const changedKeys = new Set(Object.keys(after.args).filter(k => k in current && (current[k] !== after.args![k] || dup?.has(k))))
      if (changedKeys.size > 0) {
        for (const o of stored.filter(o => changedKeys.has(o.key))) {
          await ctx.run('docker-options:remove', target, 'build', o.raw)
          ctx.needsRebuild(target, 'build args')
        }
      }
      for (const [key, value] of Object.entries(after.args)) {
        if (key in current && !changedKeys.has(key)) continue
        await ctx.run('docker-options:add', target, 'build', `--build-arg ${quoteShellArg(`${key}=${value}`)}`)
        ctx.needsRebuild(target, 'build args')
      }
    }
  },
}
