import type { Runner } from '../core/dokku.js'
import type { AppConfig } from '../core/schema.js'

type DockerOptionsConfig = NonNullable<AppConfig['docker_options']>

export async function ensureAppDockerOptions(
  runner: Runner,
  app: string,
  options: DockerOptionsConfig
): Promise<void> {
  const phases = (['build', 'deploy', 'run'] as const)
  for (const phase of phases) {
    const opts = options[phase]
    if (!opts || opts.length === 0) continue
    // Clear then add (idempotent replacement)
    await runner.run('docker-options:clear', app, phase)
    for (const opt of opts) {
      await runner.run('docker-options:add', app, phase, opt)
    }
  }
}
