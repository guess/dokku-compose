import type { Runner } from '../core/dokku.js'
import type { AppConfig } from '../core/schema.js'
import { logAction, logDone, logSkip } from '../core/logger.js'

type NetworkConfig = NonNullable<AppConfig['network']>

export async function ensureNetworks(runner: Runner, networks: string[]): Promise<void> {
  for (const net of networks) {
    logAction('network', `Creating ${net}`)
    const exists = await runner.check('network:exists', net)
    if (exists) { logSkip(); continue }
    await runner.run('network:create', net)
    logDone()
  }
}

export async function ensureAppNetworks(
  runner: Runner,
  app: string,
  networks: string[] | undefined
): Promise<void> {
  if (!networks || networks.length === 0) return
  logAction(app, 'Setting networks')
  await runner.run('network:set', app, 'attach-post-deploy', ...networks)
  logDone()
}

export async function ensureAppNetwork(
  runner: Runner,
  app: string,
  network: NetworkConfig | undefined
): Promise<void> {
  if (!network) return
  if (network.attach_post_create !== undefined && network.attach_post_create !== false) {
    const nets = Array.isArray(network.attach_post_create)
      ? network.attach_post_create
      : [network.attach_post_create]
    await runner.run('network:set', app, 'attach-post-create', ...nets)
  }
  if (network.initial_network !== undefined && network.initial_network !== false) {
    await runner.run('network:set', app, 'initial-network', network.initial_network)
  }
  if (network.bind_all_interfaces !== undefined) {
    await runner.run('network:set', app, 'bind-all-interfaces', String(network.bind_all_interfaces))
  }
  if (network.tld !== undefined && network.tld !== false) {
    await runner.run('network:set', app, 'tld', network.tld)
  }
}

export async function exportNetworks(runner: Runner): Promise<string[]> {
  const output = await runner.query('network:list')
  return output.split('\n').map(s => s.trim()).filter(Boolean)
}

export async function exportAppNetwork(
  runner: Runner,
  app: string
): Promise<{ networks?: string[]; network?: NetworkConfig } | undefined> {
  const output = await runner.query('network:report', app)
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
