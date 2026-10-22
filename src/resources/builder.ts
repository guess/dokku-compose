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

/**
 * The `--build-arg` options of the build docker options line, as Dokku prints
 * them: options are space-joined and each starts with `--`, so a value may
 * contain spaces. `raw` is the exact option text.
 */
function parseBuildOptions(dockerOptsBuild: string): { key: string; value: string; raw: string }[] {
  const out: { key: string; value: string; raw: string }[] = []
  for (const raw of dockerOptsBuild.trim().split(/\s+(?=--\S)/)) {
    const m = raw.match(/^--build-arg\s+([^=\s]+)=?(.*)$/s)
    if (m) out.push({ key: m[1], value: m[2], raw })
  }
  return out
}

function parseBuildArgs(dockerOptsBuild: string): Record<string, string> {
  const args: Record<string, string> = {}
  for (const o of parseBuildOptions(dockerOptsBuild)) args[o.key] = o.value
  return args
}

function buildConfigFromReports(
  builderReport: Record<string, string>,
  dockerfileReport: Record<string, string>,
  appJsonReport: Record<string, string>,
  dockerOptsBuild: string
): BuildConfig {
  const config: BuildConfig = {}

  if (dockerfileReport['dockerfile-path'])
    config.dockerfile = dockerfileReport['dockerfile-path']
  if (appJsonReport['selected'])
    config.app_json = appJsonReport['selected']
  if (builderReport['build-dir'])
    config.context = builderReport['build-dir']

  const args = parseBuildArgs(dockerOptsBuild)
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
    const report = parseReport(await ctx.query('docker-options:report', target), 'docker-options')
    const options = parseBuildOptions(report['build'] ?? '').filter(o => stale.has(o.key))
    for (const o of options) await ctx.run('docker-options:remove', target, 'build', o.raw)
    for (const k of stale) {
      if (!options.some(o => o.key === k)) logWarn(target, `build arg '${k}' not found as an exact docker option; left as is`)
    }
  },

  async read(ctx: Context, target: string): Promise<BuildConfig> {
    const [builderRaw, dockerfileRaw, appJsonRaw, dockerOptsRaw] = await Promise.all([
      ctx.query('builder:report', target),
      ctx.query('builder-dockerfile:report', target),
      ctx.query('app-json:report', target),
      ctx.query('docker-options:report', target),
    ])
    return buildConfigFromReports(
      parseReport(builderRaw, 'builder'),
      parseReport(dockerfileRaw, 'builder-dockerfile'),
      parseReport(appJsonRaw, 'app-json'),
      parseReport(dockerOptsRaw, 'docker-options')['build'] ?? ''
    )
  },

  async readAll(ctx: Context): Promise<Map<string, BuildConfig>> {
    const [builderRaw, dockerfileRaw, appJsonRaw, dockerOptsRaw] = await Promise.all([
      ctx.query('builder:report'),
      ctx.query('builder-dockerfile:report'),
      ctx.query('app-json:report'),
      ctx.query('docker-options:report'),
    ])
    const builderBulk = parseBulkReport(builderRaw, 'builder')
    const dockerfileBulk = parseBulkReport(dockerfileRaw, 'builder-dockerfile')
    const appJsonBulk = parseBulkReport(appJsonRaw, 'app-json')
    const dockerOptsBulk = parseBulkReport(dockerOptsRaw, 'docker-options')

    const result = new Map<string, BuildConfig>()
    for (const app of builderBulk.keys()) {
      result.set(app, buildConfigFromReports(
        builderBulk.get(app) ?? {},
        dockerfileBulk.get(app) ?? {},
        appJsonBulk.get(app) ?? {},
        dockerOptsBulk.get(app)?.['build'] ?? ''
      ))
    }
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
