import type { Resource } from '../core/reconcile.js'
import type { Context } from '../core/context.js'
import { parseReport, parseBulkReport } from './parsers.js'

type BuildConfig = {
  dockerfile?: string
  app_json?: string
  context?: string
  args?: Record<string, string>
}

function parseBuildArgs(dockerOptsBuild: string): Record<string, string> {
  const args: Record<string, string> = {}
  // Options are space-separated on one line: --build-arg K=V --link ... --build-arg K2=V2
  const matches = dockerOptsBuild.matchAll(/--build-arg\s+(\S+?)=(\S+)/g)
  for (const m of matches) args[m[1]] = m[2]
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

  async read(ctx: Context, target: string): Promise<BuildConfig> {
    const [builderRaw, dockerfileRaw, appJsonRaw, dockerOptsRaw] = await Promise.all([
      ctx.query('builder:report', target),
      ctx.query('builder-dockerfile:report', target),
      ctx.query('app-json:report', target),
      ctx.query('docker-options:report', target),
    ])
    const dockerOptsReport = parseReport(dockerOptsRaw, 'docker-options')
    return buildConfigFromReports(
      parseReport(builderRaw, 'builder'),
      parseReport(dockerfileRaw, 'builder-dockerfile'),
      parseReport(appJsonRaw, 'app-json'),
      dockerOptsReport['build'] ?? ''
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

    if (process.env.DOKKU_COMPOSE_DEBUG) {
      console.error('[debug] builderRaw length:', builderRaw.length)
      console.error('[debug] dockerfileRaw length:', dockerfileRaw.length)
      console.error('[debug] appJsonRaw length:', appJsonRaw.length)
      console.error('[debug] dockerOptsRaw length:', dockerOptsRaw.length)
      console.error('[debug] dockerfileRaw first 300:', JSON.stringify(dockerfileRaw.slice(0, 300)))
      console.error('[debug] dockerOptsRaw first 300:', JSON.stringify(dockerOptsRaw.slice(0, 300)))
      console.error('[debug] builderBulk keys:', [...builderBulk.keys()])
      console.error('[debug] dockerfileBulk keys:', [...dockerfileBulk.keys()])
      console.error('[debug] dockerOptsBulk keys:', [...dockerOptsBulk.keys()])
    }

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
