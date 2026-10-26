import { describe, it, expect } from 'vitest'
import { fakeContext, serviceInfoJson } from '../tests/fake-server.js'
import { ensureServiceProperties, mountCommand, mountMismatches } from './service-properties.js'
import { resolveServiceMounts } from './service-mounts.js'
import type { Config } from '../core/schema.js'

const config = {
  apps: {},
  volumes: { a: { path: '/srv/a' }, b: {}, vol: { path: 'dbvol' }, 'legacy-3f9c1a2b7d': {} },
} as unknown as Config

function setup(plugin: 'postgres' | 'redis', mounts: string) {
  return fakeContext({
    queries: {
      [`${plugin}:info db --format json`]: serviceInfoJson('db', plugin, '17', { mounts }),
      'storage:list-entries --format json': JSON.stringify([{ name: 'legacy-3f9c1a2b7d', scheduler: 'docker-local', host_path: '/srv/old' }]),
    },
    checks: {},
  })
}

describe('resolving service mounts', () => {
  it('turns entries into host paths: path:, the default location, a Docker volume, and a legacy entry from the server', async () => {
    const { ctx } = setup('postgres', '')
    expect(await resolveServiceMounts(ctx, config.volumes, [
      'a:/opt/a', 'b:/opt/b', { entry: 'vol', container_dir: '/opt/v', readonly: true, options: ['z', 'nocopy'] }, 'legacy-3f9c1a2b7d:/opt/old',
    ])).toEqual([
      '/srv/a:/opt/a', '/var/lib/dokku/data/storage/b:/opt/b', 'dbvol:/opt/v:ro,z,nocopy', '/srv/old:/opt/old',
    ])
  })

  it('is undefined without mounts:, empty for [], and an error for an undeclared or a failed entry', async () => {
    const { ctx } = setup('postgres', '')
    expect(await resolveServiceMounts(ctx, config.volumes, undefined)).toBeUndefined()
    expect(await resolveServiceMounts(ctx, config.volumes, [])).toEqual([])
    await expect(resolveServiceMounts(ctx, config.volumes, ['nope:/x'])).rejects.toThrow("entry 'nope' is not declared")
    await expect(resolveServiceMounts(ctx, config.volumes, ['a:/x'], new Map([['a', 'path differs']]))).rejects.toThrow("entry 'a' failed: path differs")
  })
})

describe.each(['postgres', 'redis'] as const)('%s mounts', plugin => {
  it('runs nothing when the resolved sets match, whatever the order', async () => {
    const { ctx, runner } = setup(plugin, 'dbvol:/opt/v:ro /srv/a:/opt/a')
    await ensureServiceProperties(ctx, plugin, { db: { mounts: [{ entry: 'vol', container_dir: '/opt/v', readonly: true }, 'a:/opt/a'] } }, config)
    expect(runner.dryRunLog).toEqual([])
    expect(ctx.serviceRestarts.size).toBe(0)
  })

  it('replaces the whole set with the resolved host paths when it differs, and lists the service for stop and start', async () => {
    const { ctx, runner } = setup(plugin, '/srv/a:/opt/a')
    await ensureServiceProperties(ctx, plugin, { db: { mounts: ['a:/opt/a', 'b:/opt/b'] } }, config)
    expect(runner.dryRunLog).toEqual([`${plugin}:mount --replace db /srv/a:/opt/a /var/lib/dokku/data/storage/b:/opt/b`])
    expect(ctx.serviceRestarts.get(`${plugin}:db`)?.reasons).toEqual(['mounts'])
  })

  it('an entry moved to another path is a change, because the resolved host path differs', async () => {
    const { ctx, runner } = setup(plugin, '/srv/old-a:/opt/a')
    await ensureServiceProperties(ctx, plugin, { db: { mounts: ['a:/opt/a'] } }, config)
    expect(runner.dryRunLog).toEqual([`${plugin}:mount --replace db /srv/a:/opt/a`])
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

  it('a service that mounts an entry that failed to converge fails its step with the entry name, and mounts nothing', async () => {
    const { ctx, runner } = setup(plugin, '')
    const failed = await ensureServiceProperties(ctx, plugin, { db: { mounts: ['a:/opt/a'] } }, config, { failedVolumes: new Map([['a', 'path differs']]) })
    expect(failed.map(f => (f.error as Error).message)).toEqual(["entry 'a' failed: path differs"])
    expect(runner.dryRunLog).toEqual([])
  })

  it('a plugin that does not report mounts fails that service instead of re-applying them every run', async () => {
    const server = fakeContext({ queries: { [`${plugin}:info db --format json`]: JSON.stringify({ image: plugin }) }, checks: {} })
    const failed = await ensureServiceProperties(server.ctx, plugin, { db: { mounts: ['a:/opt/a'] } }, config)
    expect(failed.map(f => (f.error as Error).message)).toEqual([`dokku-${plugin} too old to report mounts`])
  })
})

describe('mount drift', () => {
  const info = JSON.parse(serviceInfoJson('db', 'postgres', '17', { mounts: '/srv/a:/opt/a' }))

  it('shows the normalised resolved sets', () => {
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
