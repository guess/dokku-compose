import { describe, it, expect } from 'vitest'
import { fakeContext, serviceInfoJson } from '../tests/fake-server.js'
import { ensureServiceProperties, mountCommand, mountMismatches } from './service-properties.js'
import type { Config } from '../core/schema.js'

const config = { apps: {} } as Config

function setup(plugin: 'postgres' | 'redis', mounts: string) {
  return fakeContext({ queries: { [`${plugin}:info db --format json`]: serviceInfoJson('db', plugin, '17', { mounts }) }, checks: {} })
}

describe.each(['postgres', 'redis'] as const)('%s mounts', plugin => {
  it('runs nothing when the sets match, whatever the order, a trailing colon or an explicit rw', async () => {
    const { ctx, runner } = setup(plugin, 'vol:/data:ro /srv/a:/opt/a')
    await ensureServiceProperties(ctx, plugin, { db: { mounts: ['/srv/a:/opt/a:rw', 'vol:/data:ro', '/srv/a:/opt/a:'] } }, config)
    expect(runner.dryRunLog).toEqual([])
    expect(ctx.serviceRestarts.size).toBe(0)
  })

  it('replaces the whole set with --replace when it differs, and lists the service for stop and start', async () => {
    const { ctx, runner } = setup(plugin, '/srv/a:/opt/a')
    await ensureServiceProperties(ctx, plugin, { db: { mounts: ['/srv/a:/opt/a', 'vol:/data:ro'] } }, config)
    expect(runner.dryRunLog).toEqual([`${plugin}:mount --replace db /srv/a:/opt/a vol:/data:ro`])
    expect(ctx.serviceRestarts.get(`${plugin}:db`)?.reasons).toEqual(['mounts'])
  })

  it('mounts: [] removes every mount with unmount --all, and runs nothing when there are none', async () => {
    const some = setup(plugin, '/srv/a:/opt/a')
    await ensureServiceProperties(some.ctx, plugin, { db: { mounts: [] } }, config)
    expect(some.runner.dryRunLog).toEqual([`${plugin}:unmount --all db`])
    const none = setup(plugin, '')
    await ensureServiceProperties(none.ctx, plugin, { db: { mounts: [] } }, config)
    expect(none.runner.dryRunLog).toEqual([])
  })

  it('an absent mounts: never touches the mounts, with or without --prune', async () => {
    for (const prune of [false, true]) {
      const { ctx, runner } = setup(plugin, '/srv/a:/opt/a')
      await ensureServiceProperties(ctx, plugin, { db: { properties: { memory: 0 } } }, config, { prune })
      expect(runner.dryRunLog).toEqual([])
    }
  })

  it('a plugin that does not report mounts fails that service instead of re-applying them every run', async () => {
    const server = fakeContext({ queries: { [`${plugin}:info db --format json`]: JSON.stringify({ image: plugin }) }, checks: {} })
    const failed = await ensureServiceProperties(server.ctx, plugin, { db: { mounts: ['/srv/a:/opt/a'] } }, config)
    expect(failed.map(f => (f.error as Error).message)).toEqual([`dokku-${plugin} too old to report mounts`])
  })
})

describe('mount drift', () => {
  const info = JSON.parse(serviceInfoJson('db', 'postgres', '17', { mounts: '/srv/a:/opt/a' }))

  it('shows the normalised sets', () => {
    expect(mountMismatches('postgres', info, ['/srv/a:/opt/a', 'vol:/data:z,ro'])).toEqual([
      { field: 'mounts', desired: '/srv/a:/opt/a vol:/data:ro,z', current: '/srv/a:/opt/a' },
    ])
    expect(mountMismatches('postgres', info, ['/srv/a:/opt/a'])).toEqual([])
    expect(mountMismatches('postgres', info, undefined)).toEqual([])
    expect(mountMismatches('postgres', info, [])).toEqual([{ field: 'mounts', desired: '(none)', current: '/srv/a:/opt/a' }])
  })

  it('builds the command the way the run does', () => {
    expect(mountCommand('redis', 'cache', info, ['/srv/b:/opt/b'])).toEqual(['redis:mount', '--replace', 'cache', '/srv/b:/opt/b'])
    expect(mountCommand('redis', 'cache', info, [])).toEqual(['redis:unmount', '--all', 'cache'])
  })
})
