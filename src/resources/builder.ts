import type { Resource } from '../core/reconcile.js'
import type { Context } from '../core/context.js'
import { parseReport, parseBulkReport } from './parsers.js'
import { logWarn } from '../core/logger.js'

type BuildConfig = {
  dockerfile?: string
  app_json?: string
  context?: string
  args?: Record<string, string>
}

type BuildOption = { key: string; value: string; raw: string }

/**
 * The `--build-arg` options among the stored build docker options. Each entry
 * of `build-list` is one option's exact text (Dokku 0.38+), so a value with
 * spaces or ` --x` in it is never split. `raw` is what `docker-options:remove` needs.
 */
function parseBuildOptions(buildList: string[]): BuildOption[] {
  const out: BuildOption[] = []
  for (const raw of buildList) {
    const m = raw.match(/^--build-arg\s+([^=\s]+)=?(.*)$/s)
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
    for (const o of options) await ctx.run('docker-options:remove', target, 'build', o.raw)
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

  async readAll(ctx: Context): Promise<Map<string, BuildConfig>> {
    const [builderRaw, dockerfileRaw, appJsonRaw] = await Promise.all([
      ctx.query('builder:report'),
      ctx.query('builder-dockerfile:report'),
      ctx.query('app-json:report'),
    ])
    const builderBulk = parseBulkReport(builderRaw, 'builder')
    const dockerfileBulk = parseBulkReport(dockerfileRaw, 'builder-dockerfile')
    const appJsonBulk = parseBulkReport(appJsonRaw, 'app-json')

    // `build-list` only comes from the per-app JSON report, so read it app by app.
    const apps = [...builderBulk.keys()]
    const buildLists = await Promise.all(apps.map(app => readBuildList(ctx, app)))
    const result = new Map<string, BuildConfig>()
    apps.forEach((app, i) => {
      result.set(app, buildConfigFromReports(
        builderBulk.get(app) ?? {},
        dockerfileBulk.get(app) ?? {},
        appJsonBulk.get(app) ?? {},
        buildLists[i]
      ))
    })
    return result
  },

  async onChange(ctx: Context, target: string, { after }: { after: BuildConfig }): Promise<void> {
    if (after.dockerfile)
      await ctx.run('builder-dockerfile:set', target, 'dockerfile-path', after.dockerfile)
    if (after.app_json)
      await ctx.run('app-json:set', target, 'appjson-path', after.app_json)
    if (after.context)
      await ctx.run('builder:set', target, 'build-dir', after.context)
    if (after.args) {
      for (const [key, value] of Object.entries(after.args)) {
        await ctx.run('docker-options:add', target, 'build', `--build-arg ${key}=${value}`)
      }
    }
  },
}
