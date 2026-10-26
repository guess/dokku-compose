import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { runExport } from './export.js'
import { emptyAnswer, serviceInfoJson } from '../tests/fake-server.js'
import { parseConfig } from '../core/schema.js'

afterEach(() => vi.restoreAllMocks())

const ENTRIES = [
  { name: 'data', scheduler: 'docker-local', host_path: '/var/lib/dokku/data/storage/data', chown: '999' },
  { name: 'dumps', scheduler: 'docker-local', host_path: '/srv/dumps' },
  { name: 'legacy-3f9c1a2b7d', scheduler: 'docker-local', host_path: '/srv/old-backups' },
  { name: 'cluster', scheduler: 'k3s', host_path: '/srv/k3s' },
]

function exportOf(plugin: 'postgres' | 'redis', mounts: string, opts: { appFilter?: string[] } = {}, entries = ENTRIES) {
  const runner = createRunner({ dryRun: false })
  runner.query = vi.fn(async (...args: string[]) => {
    const key = args.join(' ')
    if (args[0] === 'version') return 'dokku version 0.38.32'
    if (args[0] === 'apps:list') return ''
    if (key === `${plugin}:list`) return `=====> ${plugin} services\ndb`
    if (key === `${plugin}:info db`) return 'Version: x:1'
    if (key === `${plugin}:info db --format json`) return serviceInfoJson('db', plugin, '1', { mounts })
    if (key === 'storage:list-entries --format json') return JSON.stringify(entries)
    return emptyAnswer(...args) ?? ''
  })
  runner.queryStrict = vi.fn(async (...args: string[]) => {
    const out = await runner.query(...args)
    if (out) return out
    return args[0] === 'plugin:list' ? '[]' : args.includes('json') ? '{}' : out
  })
  runner.check = vi.fn().mockResolvedValue(false)
  return runExport(createContext(runner), opts)
}

describe.each(['postgres', 'redis'] as const)('%s export of mounts', plugin => {
  it('names the declared entry at each mount host path, in the long form when it has options', async () => {
    const out = await exportOf(plugin, '/var/lib/dokku/data/storage/data:/opt/extra /srv/dumps:/opt/dumps:ro,z')
    // in the order of the host paths, as the server lists mounts
    expect(out[plugin]!.db.mounts).toEqual([
      { entry: 'dumps', container_dir: '/opt/dumps', readonly: true, options: ['z'] },
      'data:/opt/extra',
    ])
    expect(out.volumes).toMatchObject({ data: { chown: 999 }, dumps: { path: '/srv/dumps' } })
  })

  it('writes a legacy entry under the name made from its path, and a new entry for a directory no entry points at', async () => {
    const out = await exportOf(plugin, '/srv/old-backups:/opt/old /srv/fresh-dir:/opt/fresh dbvol:/opt/vol')
    expect(out[plugin]!.db.mounts).toEqual(['fresh-dir:/opt/fresh', 'old-backups:/opt/old', 'dbvol:/opt/vol'])
    expect(out.volumes).toMatchObject({
      'old-backups': { path: '/srv/old-backups' },
      'fresh-dir': { path: '/srv/fresh-dir' },
      dbvol: { path: 'dbvol' },
    })
  })

  it('a directory at the default location of its new entry is written with chown: false, never the herokuish default', async () => {
    const out = await exportOf(plugin, '/var/lib/dokku/data/storage/scratch:/opt/scratch')
    expect(out[plugin]!.db.mounts).toEqual(['scratch:/opt/scratch'])
    expect(out.volumes!.scratch).toEqual({ chown: false })
  })

  it('keeps an entry a service mounts when only some apps are exported', async () => {
    const out = await exportOf(plugin, '/srv/dumps:/opt/dumps', { appFilter: ['myapp'] })
    expect(out.volumes).toEqual({ dumps: { path: '/srv/dumps' } })
  })

  it('leaves out a mount that no valid entry name can describe, with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = await exportOf(plugin, '/:/opt/root')
    expect(out[plugin]!.db.mounts).toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })

  it('the exported file is valid as it stands (apart from placeholders) and names only declared entries', async () => {
    const out = await exportOf(plugin, '/var/lib/dokku/data/storage/data:/opt/extra /srv/fresh-dir:/opt/fresh')
    expect(() => parseConfig(out)).not.toThrow()
  })

  it('writes no mounts: for a service with none', async () => {
    const out = await exportOf(plugin, '')
    expect(out[plugin]!.db.mounts).toBeUndefined()
  })
})
