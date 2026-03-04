import type { Context } from '../core/context.js'
import type { AppConfig } from '../core/schema.js'
import { logAction, logDone, logSkip } from '../core/logger.js'

type NetworkConfig = NonNullable<AppConfig['network']>

export async function ensureNetworks(ctx: Context, networks: string[]): Promise<void> {
  for (const net of networks) {
    logAction('network', `Creating ${net}`)
    const exists = await ctx.check('network:exists', net)
    if (exists) { logSkip(); continue }
    await ctx.run('network:create', net)
    logDone()
  }
}

export async function ensureAppNetworks(
  ctx: Context,
  app: string,
  networks: string[] | undefined
): Promise<void> {
  if (!networks || networks.length === 0) return
  logAction(app, 'Setting networks')
  await ctx.run('network:set', app, 'attach-post-deploy', ...networks)
  logDone()
}

export async function ensureAppNetwork(
  ctx: Context,
  app: string,
  network: NetworkConfig | undefined
): Promise<void> {
  if (!network) return
  if (network.attach_post_create !== undefined && network.attach_post_create !== false) {
    const nets = Array.isArray(network.attach_post_create)
      ? network.attach_post_create
      : [network.attach_post_create]
    await ctx.run('network:set', app, 'attach-post-create', ...nets)
  }
  if (network.initial_network !== undefined && network.initial_network !== false) {
    await ctx.run('network:set', app, 'initial-network', network.initial_network)
  }
  if (network.bind_all_interfaces !== undefined) {
    await ctx.run('network:set', app, 'bind-all-interfaces', String(network.bind_all_interfaces))
  }
  if (network.tld !== undefined && network.tld !== false) {
    await ctx.run('network:set', app, 'tld', network.tld)
  }
}

const DOCKER_BUILTIN_NETWORKS = new Set(['bridge', 'host', 'none'])

export async function exportNetworks(ctx: Context): Promise<string[]> {
  const output = await ctx.query('network:list')
  return output.split('\n')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('=====>' ) && !DOCKER_BUILTIN_NETWORKS.has(s))
}

export async function exportAppNetwork(
  ctx: Context,
  app: string
): Promise<{ networks?: string[]; network?: NetworkConfig } | undefined> {
  const output = await ctx.query('network:report', app)
  if (!output) return undefined
  // Parse key: value pairs from network:report output
  const result: { networks?: string[]; network?: NetworkConfig } = {}
  const lines = output.split('\n')
  for (const line of lines) {
    const [key, ...valueParts] = line.split(':').map(s => s.trim())
    const value = valueParts.join(':').trim()
    if (!key || !value) continue
    if (key === 'Network attach post deploy') {
      result.networks = value.split(' ').filter(Boolean)
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}
