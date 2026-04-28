import type { Context } from '../core/context.js'
import type { DockerAuthEntry } from '../core/schema.js'
import { logAction, logDone } from '../core/logger.js'

export async function ensureDockerAuth(
  ctx: Context,
  config: Record<string, DockerAuthEntry>
): Promise<void> {
  for (const [server, creds] of Object.entries(config)) {
    logAction('docker-auth', `Logging in to ${server} as ${creds.username}`)
    await ctx.run('registry:login', server, creds.username, creds.password)
    logDone()
  }
}
