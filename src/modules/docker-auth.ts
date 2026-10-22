import type { Context } from '../core/context.js'
import type { DockerAuthEntry } from '../core/schema.js'
import { logAction, logDone, logSkip } from '../core/logger.js'

// registry:auth-status exit codes (Dokku >= 0.38.29, plugins/registry/auth_status.go).
const AUTH_MATCH = 0
const AUTH_MISSING = 1
const AUTH_DIFFERS = 2
const AUTH_INVALID_ARGUMENTS = 3
const AUTH_UNKNOWN = 4

/**
 * The server name `registry:report --registry-global-auth-servers` prints for
 * a file's key: scheme and path stripped, every Docker Hub alias as docker.io
 * (Dokku's convertToHostname/dockerAuthKey).
 */
export function registryHostname(server: string): string {
  const host = server.replace(/^https?:\/\//, '').split('/')[0]
  return ['', 'docker.io', 'index.docker.io', 'hub.docker.com', 'docker.com'].includes(host) ? 'docker.io' : host
}

/** Whether the stored global login for `server` matches; the password goes on stdin. */
async function loginMatches(ctx: Context, server: string, creds: DockerAuthEntry): Promise<boolean> {
  const code = await ctx.status(
    ['registry:auth-status', '--global', '--password-stdin', server, creds.username],
    creds.password
  )
  if (code === AUTH_MATCH) return true
  if (code === AUTH_MISSING || code === AUTH_DIFFERS || code === AUTH_UNKNOWN) return false
  if (code === AUTH_INVALID_ARGUMENTS) {
    throw new Error(`registry:auth-status rejected the arguments for ${server} (exit 3)`)
  }
  throw new Error(`registry:auth-status failed for ${server} (exit ${code})`)
}

async function globalAuthServers(ctx: Context): Promise<string[]> {
  const raw = await ctx.query('registry:report', '--global', '--registry-global-auth-servers')
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

export async function ensureDockerAuth(
  ctx: Context,
  config: Record<string, DockerAuthEntry>
): Promise<void> {
  for (const [server, creds] of Object.entries(config)) {
    logAction('docker-auth', `Logging in to ${server} as ${creds.username}`)
    if (await loginMatches(ctx, server, creds)) {
      logSkip()
      continue
    }
    await ctx.runWithInput(creds.password, 'registry:login', '--global', '--password-stdin', server, creds.username)
    logDone()
  }
}

/** `--prune`: log out of every global registry login the file does not list. */
export async function pruneDockerAuth(
  ctx: Context,
  config: Record<string, DockerAuthEntry>
): Promise<void> {
  const declared = new Set(Object.keys(config).map(registryHostname))
  for (const server of await globalAuthServers(ctx)) {
    if (declared.has(server)) continue
    logAction('docker-auth', `Logging out of ${server}`)
    await ctx.run('registry:logout', '--global', server)
    logDone()
  }
}

/** For `diff`: declared logins that are missing or differ, and global logins the file does not list. */
export async function readDockerAuthDrift(
  ctx: Context,
  config: Record<string, DockerAuthEntry>
): Promise<{ stale: string[]; extra: string[] }> {
  const stale: string[] = []
  for (const [server, creds] of Object.entries(config)) {
    if (!(await loginMatches(ctx, server, creds))) stale.push(server)
  }
  const declared = new Set(Object.keys(config).map(registryHostname))
  const extra = (await globalAuthServers(ctx)).filter(s => !declared.has(s))
  return { stale, extra }
}
