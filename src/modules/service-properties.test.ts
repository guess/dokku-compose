import { describe, it, expect, vi, afterEach } from 'vitest'
import { fakeContext, serviceInfoJson } from '../tests/fake-server.js'
import { ensureServiceProperties, propertyChanges, propertyMismatches } from './service-properties.js'
import type { Config } from '../core/schema.js'

const config = { apps: {} } as Config

function setup(plugin: 'postgres' | 'redis', onServer: Record<string, string> = {}) {
  const image = plugin === 'postgres' ? 'postgres' : 'redis'
  const server = fakeContext({
    queries: { [`${plugin}:info db --format json`]: serviceInfoJson('db', image, '17', onServer) },
    checks: {},
  })
  return server
}

describe.each(['postgres', 'redis'] as const)('%s properties', plugin => {
  afterEach(() => vi.restoreAllMocks())

  it('runs nothing when every declared key matches', async () => {
    const { ctx, runner } = setup(plugin, { memory: '512', 'restart-policy': 'always', 'post-create-network': 'b,a', 'custom-env': 'B=2;A=1' })
    const failed = await ensureServiceProperties(ctx, plugin, {
      db: { properties: { memory: 512, 'restart-policy': 'always', 'post-create-network': ['a', 'b'], 'custom-env': { A: 1, B: 2 } } },
    }, config)
    expect(failed).toEqual([])
    expect(runner.dryRunLog).toEqual([])
    expect(ctx.serviceRestarts.size).toBe(0)
  })

  it('sets exactly the keys that differ, after --, and records the stop-and-start ones once', async () => {
    const { ctx, runner } = setup(plugin, { memory: '256', 'wait-timeout': '60' })
    await ensureServiceProperties(ctx, plugin, {
      db: { properties: { memory: 512, 'wait-timeout': 60, 'shm-size': '256m', 'log-opt': ['max-size=10m', 'max-file=3'], 'config-options': '-c max_connections=200' } },
    }, config)
    expect(runner.dryRunLog).toEqual([
      `${plugin}:set db memory -- 512`,
      `${plugin}:set db shm-size -- 256m`,
      `${plugin}:set db log-opt -- max-size=10m,max-file=3`,
      `${plugin}:set db config-options -- '-c max_connections=200'`,
    ])
    expect([...ctx.serviceRestarts.values()]).toEqual([
      { plugin, service: 'db', reasons: ['memory', 'shm-size', 'log-opt', 'config-options'] },
    ])
  })

  it('sets volume-targets as one sorted space-joined value listed for stop and start', async () => {
    const { ctx, runner } = setup(plugin, { 'volume-targets': 'data=/old' })
    await ensureServiceProperties(ctx, plugin, { db: { properties: { 'volume-targets': { data: '/var/lib/x', backups: '/srv/b' } } } }, config)
    expect(runner.dryRunLog).toEqual([
      `${plugin}:set db volume-targets -- 'backups=/srv/b data=/var/lib/x'`,
    ])
    expect(ctx.serviceRestarts.get(`${plugin}:db`)?.reasons).toEqual(['volume-targets'])
  })

  it('volume-targets in another order is the same set', async () => {
    const { ctx, runner } = setup(plugin, { 'volume-targets': 'backups=/srv/b data=/var/lib/x' })
    await ensureServiceProperties(ctx, plugin, { db: { properties: { 'volume-targets': 'data=/var/lib/x backups=/srv/b' } } }, config)
    expect(runner.dryRunLog).toEqual([])
  })

  it('--prune clears volume-targets the file dropped', async () => {
    const { ctx, runner } = setup(plugin, { 'volume-targets': 'a=/a' })
    await ensureServiceProperties(ctx, plugin, { db: {} }, config, { prune: true })
    expect(runner.dryRunLog).toEqual([`${plugin}:set db volume-targets`])
  })

  it('a key that takes effect at once adds no restart; an unknown key is set and compared as an exact string', async () => {
    const { ctx, runner } = setup(plugin, { 'some-future-key': 'a,b' })
    await ensureServiceProperties(ctx, plugin, { db: { properties: { 'wait-timeout': 120, 'some-future-key': 'b,a' } } }, config)
    expect(runner.dryRunLog).toEqual([`${plugin}:set db wait-timeout -- 120`, `${plugin}:set db some-future-key -- b,a`])
    expect(ctx.serviceRestarts.size).toBe(0)
  })

  it('a declared default sets once and then matches', async () => {
    const first = setup(plugin)
    await ensureServiceProperties(first.ctx, plugin, { db: { properties: { 'restart-policy': 'always' } } }, config)
    expect(first.runner.dryRunLog).toEqual([`${plugin}:set db restart-policy -- always`])
    const second = setup(plugin, { 'restart-policy': 'always' })
    await ensureServiceProperties(second.ctx, plugin, { db: { properties: { 'restart-policy': 'always' } } }, config)
    expect(second.runner.dryRunLog).toEqual([])
  })

  it('an absent or empty properties block, without --prune, reads nothing and runs nothing', async () => {
    const { ctx, runner } = setup(plugin, { memory: '512' })
    await ensureServiceProperties(ctx, plugin, { db: {} }, config)
    expect(runner.dryRunLog).toEqual([])
    expect(runner.queryStrict).not.toHaveBeenCalled()
  })

  it('--prune clears known keys the file dropped, never an unknown key, and leaves defaults alone', async () => {
    const { ctx, runner } = setup(plugin, { memory: '512', 'log-driver': 'json-file', 'restart-policy': '', 'backup-bucket': 'b', 'some-future-key': 'x', version: '17' })
    await ensureServiceProperties(ctx, plugin, { db: { properties: { 'log-driver': 'json-file' } } }, config, { prune: true })
    expect(runner.dryRunLog).toEqual([`${plugin}:set db memory`])
    expect(ctx.serviceRestarts.get(`${plugin}:db`)?.reasons).toEqual(['memory'])
  })

  it('--prune with no properties block reads the service once and clears the known keys', async () => {
    const { ctx, runner } = setup(plugin, { 'custom-env': 'A=1', 'wait-timeout': '30' })
    await ensureServiceProperties(ctx, plugin, { db: {} }, config, { prune: true })
    expect(runner.dryRunLog).toEqual([`${plugin}:set db wait-timeout`, `${plugin}:set db custom-env`])
    expect(ctx.serviceRestarts.get(`${plugin}:db`)?.reasons).toEqual(['custom-env'])
  })

  it('--prune never clears the password', async () => {
    const { ctx, runner } = setup(plugin, { 'password-fingerprint': 'a'.repeat(64) })
    await ensureServiceProperties(ctx, plugin, { db: {} }, config, { prune: true })
    expect(runner.dryRunLog).toEqual([])
  })

  it('reads again after a set, so later readers do not see stale info', async () => {
    const { ctx, runner } = setup(plugin)
    await ensureServiceProperties(ctx, plugin, { db: { properties: { memory: 1 } } }, config)
    await ensureServiceProperties(ctx, plugin, { db: { properties: { memory: 1 } } }, config)
    expect((runner.queryStrict as any).mock.calls.filter((c: string[]) => c[0] === `${plugin}:info`)).toHaveLength(2)
  })

  it('a service that fails is reported and returned, and the next service still runs', async () => {
    const server = fakeContext({
      queries: { [`${plugin}:info db --format json`]: serviceInfoJson('db', 'x', '1'), [`${plugin}:info db2 --format json`]: serviceInfoJson('db2', 'x', '1') },
      checks: {},
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const run = server.runner.run
    server.runner.run = vi.fn(async (...args: string[]) => {
      if (args[1] === 'db') throw new Error('Invalid key specified')
      return run(...args)
    })
    const failed = await ensureServiceProperties(server.ctx, plugin, {
      db: { properties: { memory: 1 } }, db2: { properties: { memory: 2 } },
    }, config)
    expect(failed.map(f => f.service)).toEqual(['db'])
    expect(server.runner.dryRunLog).toEqual([`${plugin}:set db2 memory -- 2`])
    expect(error).toHaveBeenCalled()
  })

  it('a service planned for creation in a dry run is left to its create flags', async () => {
    const { ctx, runner } = setup(plugin)
    await ensureServiceProperties(ctx, plugin, { db: { properties: { memory: 1 } } }, config, { dryRun: true, dryRunCreated: new Set(['db']) })
    expect(runner.dryRunLog).toEqual([])
    expect(runner.queryStrict).not.toHaveBeenCalled()
  })
})

describe('propertyChanges and propertyMismatches', () => {
  const info = JSON.parse(serviceInfoJson('db', 'postgres', '17', { memory: '512', 'custom-env': 'TZ=UTC', 'log-driver': 'json-file' }))

  it('names a drift as ~ and a key the file omits as removed', () => {
    expect(propertyMismatches('postgres', info, { memory: 256 })).toEqual([
      { field: 'properties.memory', desired: '256', current: '512' },
      { field: 'properties.log-driver', desired: '(not in the file)', current: 'json-file', removed: true },
      { field: 'properties.custom-env', desired: '(not in the file)', current: 'TZ=UTC', removed: true },
    ])
  })

  it('shows no drift for an equal set', () => {
    expect(propertyMismatches('postgres', info, { memory: 512, 'custom-env': { TZ: 'UTC' }, 'log-driver': 'json-file' })).toEqual([])
  })

  it('without --prune the changes are only the declared keys', () => {
    expect(propertyChanges('postgres', info, { memory: 256 }, false).map(c => c.key)).toEqual(['memory'])
    expect(propertyChanges('postgres', info, { memory: 256 }, true).map(c => c.key)).toEqual(['memory', 'log-driver', 'custom-env'])
  })
})
