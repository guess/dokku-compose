import type { Runner } from '../core/dokku.js'
import type { PluginConfig } from '../core/schema.js'
import { logAction, logDone, logSkip } from '../core/logger.js'

export async function ensurePlugins(
  runner: Runner,
  plugins: Record<string, PluginConfig>
): Promise<void> {
  const listOutput = await runner.query('plugin:list')
  const installedNames = new Set(
    listOutput.split('\n')
      .map(line => line.trim().split(/\s+/)[0])
      .filter(Boolean)
  )

  for (const [name, config] of Object.entries(plugins)) {
    logAction('plugins', `Installing ${name}`)
    if (installedNames.has(name)) {
      logSkip()
      continue
    }
    await runner.run('plugin:install', config.url, '--name', name)
    logDone()
  }
}
