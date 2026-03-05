import type { Context } from '../core/context.js'
import type { PluginConfig } from '../core/schema.js'
import { logAction, logDone, logSkip } from '../core/logger.js'

export async function ensurePlugins(
  ctx: Context,
  plugins: Record<string, PluginConfig>
): Promise<void> {
  for (const [name, config] of Object.entries(plugins)) {
    logAction('plugins', `Installing ${name}`)
    if (await ctx.check('plugin:installed', name)) {
      logSkip()
      continue
    }
    await ctx.run('plugin:install', config.url, '--name', name)
    logDone()
  }
}
