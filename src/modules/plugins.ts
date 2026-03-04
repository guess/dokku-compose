import type { Context } from '../core/context.js'
import type { PluginConfig } from '../core/schema.js'
import { logAction, logDone, logSkip } from '../core/logger.js'

export async function ensurePlugins(
  ctx: Context,
  plugins: Record<string, PluginConfig>
): Promise<void> {
  const listOutput = await ctx.query('plugin:list')
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
    await ctx.run('plugin:install', config.url, '--name', name)
    logDone()
  }
}
