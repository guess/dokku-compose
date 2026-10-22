import type { Resource } from '../core/reconcile.js'
import type { Context } from '../core/context.js'
import { parseReport } from './parsers.js'
import { logWarn } from '../core/logger.js'
import { shellSplit, quoteShellArg } from '../core/shellwords.js'

type BuildConfig = {
  dockerfile?: string
  app_json?: string
  context?: string
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

  const args = parseBuildArgs(buildList)
  if (Object.keys(args).length > 0) config.args = args

  return config
}

export const Builder: Resource<BuildConfig> = {
  key: 'build',
  additive: true,
  // Build args (`--build-arg KEY=...` build docker options) whose KEY is not in `build.args`.
  removals: (current, desired) =>
    Object.keys(current?.args ?? {})
      .filter(k => !(desired?.args && k in desired.args))
      .map(k => `args.${k}`),
  // Remove exactly the stale `--build-arg` options; other build options stay.
  prune: async (ctx, target, removed) => {
    const stale = new Set(removed.map(l => l.slice('args.'.length)))
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
    if (after.args) {
      // Only what differs: an unchanged arg runs nothing, a changed one first
      // removes every stored option for its key (by exact stored text; `add`
      // appends without dedupe), then adds the new value.
      const stored = parseBuildOptions(await readBuildList(ctx, target))
      const current: Record<string, string> = {}
      for (const o of stored) current[o.key] = o.value
      const changedKeys = new Set(Object.keys(after.args).filter(k => k in current && current[k] !== after.args![k]))
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
