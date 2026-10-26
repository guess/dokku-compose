import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'crypto'
import { fakeContext, serviceInfoJson } from '../tests/fake-server.js'
import { ensureServiceProperties, propertyMismatches, linkedApps } from './service-properties.js'
import type { Config } from '../core/schema.js'

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex')
const config = { apps: { myapp: { links: ['db'] }, worker: { links: [{ service: 'db', alias: 'MAIN' }] }, other: { links: ['cache'] } } } as unknown as Config

function setup(plugin: 'postgres' | 'redis', fingerprint: string, links = 'myapp,billing') {
  return fakeContext({
    queries: {
      [`${plugin}:info db --format json`]: serviceInfoJson('db', plugin, '17', { 'password-fingerprint': fingerprint, links }),
    },
    checks: {},
  })
}

describe.each(['postgres', 'redis'] as const)('%s password', plugin => {
  it('runs nothing when the fingerprint is the sha256 of the declared password', async () => {
    const { ctx, runner } = setup(plugin, sha256('hunter2.ok'))
    await ensureServiceProperties(ctx, plugin, { db: { properties: { password: 'hunter2.ok' } } }, config)
    expect(runner.dryRunLog).toEqual([])
    expect(ctx.restarts.size).toBe(0)
  })

  it('sets a different password with --no-restart and -- first, then lists every linked app, not the service', async () => {
    const { ctx, runner } = setup(plugin, sha256('old'))
    await ensureServiceProperties(ctx, plugin, { db: { properties: { password: '-new.pass~1' } } }, config)
    expect(runner.dryRunLog).toEqual([`${plugin}:set --no-restart db password -- '-new.pass~1'`])
    expect([...ctx.restarts]).toEqual([['myapp', ['db password changed']], ['billing', ['db password changed']]])
    expect(ctx.serviceRestarts.size).toBe(0)
  })

  it('sets a password the service has none of', async () => {
    const { ctx, runner } = setup(plugin, '')
    await ensureServiceProperties(ctx, plugin, { db: { properties: { password: 'first-pass' } } }, config)
    expect(runner.dryRunLog).toEqual([`${plugin}:set --no-restart db password -- first-pass`])
  })

  it('a dry run also lists the apps whose links: name the service', async () => {
    const { ctx } = setup(plugin, sha256('old'), '')
    await ensureServiceProperties(ctx, plugin, { db: { properties: { password: 'new-pass' } } }, config, { dryRun: true })
    expect([...ctx.restarts.keys()]).toEqual(['myapp', 'worker'])
  })

  it('a real run lists only the linked apps the server reports', async () => {
    const info = JSON.parse(serviceInfoJson('db', plugin, '17', { links: 'myapp,billing' }))
    expect(linkedApps(info, 'db', config)).toEqual(['myapp', 'billing'])
    expect(linkedApps(JSON.parse(serviceInfoJson('db', plugin, '17', { links: '' })), 'db', config)).toEqual([])
  })

  it('a stopped service fails that service with the plugin message, and lists no app', async () => {
    const { ctx, runner } = setup(plugin, sha256('old'))
    const run = runner.run
    runner.run = vi.fn(async (...args: string[]) => {
      if (args.includes('password')) throw new Error('service db is not running')
      return run(...args)
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const failed = await ensureServiceProperties(ctx, plugin, { db: { properties: { password: 'new-pass' } } }, config)
    expect(failed.map(f => (f.error as Error).message)).toEqual(['service db is not running'])
    expect(ctx.restarts.size).toBe(0)
    vi.restoreAllMocks()
  })

  it('a plugin that reports no password fingerprint fails the service', async () => {
    const server = fakeContext({ queries: { [`${plugin}:info db --format json`]: JSON.stringify({ image: plugin }) }, checks: {} })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const failed = await ensureServiceProperties(server.ctx, plugin, { db: { properties: { password: 'new-pass' } } }, config)
    expect(failed.map(f => (f.error as Error).message)).toEqual([`dokku-${plugin} too old to report the password fingerprint`])
    vi.restoreAllMocks()
  })

  it('diff names the drift without the password or its fingerprint', () => {
    const info = JSON.parse(serviceInfoJson('db', plugin, '17', { 'password-fingerprint': sha256('old') }))
    const drift = propertyMismatches(plugin, info, { password: 'new-pass' })
    expect(drift).toEqual([{ field: 'properties.password', desired: 'the password from the file', current: 'another password' }])
    expect(JSON.stringify(drift)).not.toContain('new-pass')
    expect(JSON.stringify(drift)).not.toContain(sha256('old'))
    expect(propertyMismatches(plugin, JSON.parse(serviceInfoJson('db', plugin, '17')), { password: 'x-pass' })[0].current).toBe('no password')
    expect(propertyMismatches(plugin, info, { password: 'old' })).toEqual([])
  })
})
