import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { runExport } from './export.js'
import { emptyAnswer, storageReportJson, type FakeAttachment } from '../tests/fake-server.js'
import { ConfigSchema } from '../core/schema.js'

type Entry = { name: string; scheduler: string; host_path?: string; chown?: string; mode?: string }

async function exportWith(apps: Record<string, FakeAttachment[]>, entries: Entry[], appFilter?: string[]) {
  const runner = createRunner({ dryRun: false })
  runner.query = vi.fn(async (...args: string[]) => {
    if (args[0] === 'version') return 'dokku version 0.38.32'
    if (args[0] === 'apps:list') return Object.keys(apps).join('\n')
    return emptyAnswer(...args) ?? ''
  })
  runner.queryStrict = vi.fn(async (...args: string[]) => {
    if (args[0] === 'storage:list-entries') return JSON.stringify(entries)
    if (args[0] === 'storage:report') return storageReportJson(apps[args[1]] ?? [])
    const out = await runner.query(...args)
    if (out) return out
    if (args[0] === 'plugin:list') return '[]'
    return args.includes('json') ? '{}' : out
  })
  runner.check = vi.fn().mockResolvedValue(false)
  return runExport(runner as any, { appFilter })
}

const e = (name: string, rest: Partial<Entry> = {}): Entry => ({
  name, scheduler: 'docker-local', host_path: `/var/lib/dokku/data/storage/${name}`, ...rest,
})

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => vi.restoreAllMocks())

describe('export: volumes and storage', () => {
  it('writes entries with their owner and mode, and a path only off the default location', async () => {
    const config = await exportWith({ myapp: [] }, [
      e('uploads', { chown: 'herokuish' }),
      e('data', { chown: '1000', mode: '0750' }),
      e('media', { host_path: '/srv/media' }),
      e('plain'),
      { name: 'cluster', scheduler: 'k3s' },
    ])
    expect(config.volumes).toEqual({
      uploads: { chown: 'herokuish' },
      data: { chown: 1000, mode: '0750' },
      media: { path: '/srv/media' },
      plain: { chown: false },
    })
  })

  it('writes mounts in the short form, and the map form when they have options', async () => {
    const config = await exportWith({
      myapp: [
        { entry: 'uploads', hostPath: '/var/lib/dokku/data/storage/uploads', containerPath: '/app/uploads' },
        { entry: 'data', hostPath: '/var/lib/dokku/data/storage/data', containerPath: '/app/data', readonly: true, phases: 'deploy' },
        { entry: 'media', hostPath: '/srv/media', containerPath: '/app/media', processType: 'worker', volumeOptions: 'Z,noexec' },
      ],
    }, [e('uploads', { chown: 'herokuish' }), e('data', { chown: 'herokuish' }), e('media', { host_path: '/srv/media' })])
    expect(config.apps.myapp.storage).toEqual([
      'uploads:/app/uploads',
      { entry: 'data', container_dir: '/app/data', readonly: true, phases: ['deploy'] },
      { entry: 'media', container_dir: '/app/media', process_type: 'worker', options: ['Z', 'noexec'] },
    ])
  })

  it('names a legacy entry after its directory and writes it with path:', async () => {
    const config = await exportWith({
      myapp: [{ entry: 'legacy-3f9c1a2b7d', hostPath: '/var/lib/dokku/data/storage/myapp/uploads', containerPath: '/app/uploads', phases: 'deploy' }],
    }, [e('legacy-3f9c1a2b7d', { host_path: '/var/lib/dokku/data/storage/myapp/uploads' })])
    expect(config.volumes).toEqual({ uploads: { path: '/var/lib/dokku/data/storage/myapp/uploads' } })
    expect(config.apps.myapp.storage).toEqual([{ entry: 'uploads', container_dir: '/app/uploads', phases: ['deploy'] }])
  })

  it('omits path: for a legacy entry on the default location, and keeps its owner as it is', async () => {
    const config = await exportWith({
      myapp: [{ entry: 'legacy-3f9c1a2b7d', hostPath: '/var/lib/dokku/data/storage/uploads', containerPath: '/app/uploads' }],
    }, [e('legacy-3f9c1a2b7d', { host_path: '/var/lib/dokku/data/storage/uploads' })])
    expect(config.volumes).toEqual({ uploads: { chown: false } })
  })

  it('skips a legacy entry nothing mounts, and a mount of another scheduler', async () => {
    const config = await exportWith({
      myapp: [{ entry: 'cluster', hostPath: 'cluster', containerPath: '/app/x' }],
    }, [e('legacy-aaaaaaaaaa', { host_path: '/srv/orphan' }), { name: 'cluster', scheduler: 'k3s' }])
    expect(config.volumes).toBeUndefined()
    expect(config.apps.myapp.storage).toBeUndefined()
  })

  it('keeps Dokku\'s name, written as {}, when no valid name results', async () => {
    const config = await exportWith({
      myapp: [{ entry: 'legacy-3f9c1a2b7d', hostPath: '/', containerPath: '/app/x' }],
    }, [e('legacy-3f9c1a2b7d', { host_path: '/' })])
    expect(config.volumes).toEqual({ 'legacy-3f9c1a2b7d': {} })
    expect(config.apps.myapp.storage).toEqual(['legacy-3f9c1a2b7d:/app/x'])
  })

  it('limits the block to the entries the exported apps mount', async () => {
    const config = await exportWith({
      myapp: [{ entry: 'uploads', hostPath: '/h', containerPath: '/app/uploads' }],
      other: [],
    }, [e('uploads', { chown: 'herokuish' }), e('unused', { chown: 'herokuish' })], ['myapp'])
    expect(Object.keys(config.volumes ?? {})).toEqual(['uploads'])
  })

  it('drops a subpath or volume-chown with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const config = await exportWith({
      myapp: [{ entry: 'uploads', hostPath: '/h', containerPath: '/app/uploads', subpath: 'sub', volumeChown: 'root' }],
    }, [e('uploads', { chown: 'herokuish' })])
    expect(config.apps.myapp.storage).toEqual(['uploads:/app/uploads'])
    expect(warn.mock.calls.map(c => String(c[0])).join('\n')).toContain('volume-subpath and volume-chown dropped')
  })

  it('writes a stored chown of false or an empty one as false, and a stored uid as a number', async () => {
    const config = await exportWith({ myapp: [] }, [e('a', { chown: 'false' }), e('b', { chown: '' }), e('c', { chown: '33' }), e('d', { chown: 'root' })])
    expect(config.volumes).toEqual({ a: { chown: false }, b: { chown: false }, c: { chown: 33 }, d: { chown: 'root' } })
  })

  it("keeps Dokku's name, written as {}, when the host path is not a valid path:", async () => {
    const config = await exportWith({
      myapp: [{ entry: 'legacy-3f9c1a2b7d', hostPath: '/srv/data/', containerPath: '/app/x' }],
    }, [e('legacy-3f9c1a2b7d', { host_path: '/srv/data/' })])
    expect(config.volumes).toEqual({ 'legacy-3f9c1a2b7d': {} })
  })

  it('does not give a legacy entry the name of an entry already on the server', async () => {
    const config = await exportWith({
      myapp: [{ entry: 'legacy-3f9c1a2b7d', hostPath: '/srv/myapp/uploads', containerPath: '/app/x' }],
    }, [e('legacy-3f9c1a2b7d', { host_path: '/srv/myapp/uploads' }), { name: 'uploads', scheduler: 'k3s' }])
    expect(Object.keys(config.volumes ?? {})).toEqual(['myapp-uploads'])
    expect(config.apps.myapp.storage).toEqual(['myapp-uploads:/app/x'])
  })

  it('exports a file that passes the schema', async () => {
    const config = await exportWith({
      myapp: [
        { entry: 'legacy-3f9c1a2b7d', hostPath: '/srv/uploads', containerPath: '/app/uploads' },
        { entry: 'data', hostPath: '/var/lib/dokku/data/storage/data', containerPath: '/app/data', readonly: true },
      ],
    }, [e('legacy-3f9c1a2b7d', { host_path: '/srv/uploads' }), e('data', { chown: '1000', mode: '0750' })])
    expect(() => ConfigSchema.parse(config)).not.toThrow()
  })
})
