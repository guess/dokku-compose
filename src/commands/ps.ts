import type { Runner } from '../core/dokku.js'
import type { Config } from '../core/schema.js'

export async function runPs(
  runner: Runner,
  config: Config,
  appFilter: string[]
): Promise<void> {
  const apps = appFilter.length > 0
    ? appFilter
    : Object.keys(config.apps)

  for (const app of apps) {
    const exists = await runner.check('apps:exists', app)
    if (!exists) {
      console.log(`${app}: not deployed`)
      continue
    }
    const report = await runner.query('ps:report', app)
    console.log(`${app}:`)
    for (const line of report.split('\n')) {
      const trimmed = line.trim()
      if (trimmed) console.log(`  ${trimmed}`)
    }
  }
}
