import type { Runner } from '../core/dokku.js'
import type { AppConfig } from '../core/schema.js'

type BuildConfig = NonNullable<AppConfig['build']>

export async function ensureAppBuilder(
  runner: Runner,
  app: string,
  build: BuildConfig
): Promise<void> {
  if (build.dockerfile) {
    await runner.run('builder-dockerfile:set', app, 'dockerfile-path', build.dockerfile)
  }
  if (build.app_json) {
    await runner.run('app-json:set', app, 'appjson-path', build.app_json)
  }
  if (build.context) {
    await runner.run('builder:set', app, 'build-dir', build.context)
  }
  if (build.args && Object.keys(build.args).length > 0) {
    for (const [key, value] of Object.entries(build.args)) {
      await runner.run('docker-options:add', app, 'build', `--build-arg ${key}=${value}`)
    }
  }
}
