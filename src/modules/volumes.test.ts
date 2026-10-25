import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeContext } from '../tests/fake-server.js'
import { ensureVolumes, desiredEntry, entryState, createArgs, readEntries, type ServerEntry } from './volumes.js'

const LIST = 'storage:list-entries --format json'

function server(entries: Partial<ServerEntry>[]) {
  return fakeContext({
    queries: { [LIST]: JSON.stringify(entries.map(e => ({ scheduler: 'docker-local', schema_version: 1, ...e }))) },
    checks: {},
  })
}

const entry = (name: string, rest: Partial<ServerEntry> = {}): Partial<ServerEntry> => ({
  name, host_path: `/var/lib/dokku/data/storage/${name}`, chown: 'herokuish', ...rest,
})

describe('desiredEntry', () => {
  it('chowns an entry at the default location to herokuish unless told otherwise', () => {
    expect(desiredEntry('uploads', {})).toEqual({ name: 'uploads', legacy: false, path: undefined, chown: 'herokuish', mode: undefined })
    expect(desiredEntry('uploads', { chown: 1000 }).chown).toBe('1000')
    expect(desiredEntry('uploads', { chown: 'root' }).chown).toBe('root')
    expect(desiredEntry('uploads', { chown: false }).chown).toBe('false')
  })

  it('does not manage owner or mode on a custom path', () => {
    expect(desiredEntry('media', { path: '/srv/media' })).toMatchObject({ path: '/srv/media', chown: undefined, mode: undefined })
    expect(desiredEntry('media', { path: '/srv/media', chown: false }).chown).toBeUndefined()
  })

  it('treats the default location as no path', () => {
    expect(desiredEntry('uploads', { path: '/var/lib/dokku/data/storage/uploads', mode: '750' }))
      .toMatchObject({ path: undefined, chown: 'herokuish', mode: '0750' })
  })

  it('keeps a legacy entry as a reference', () => {
    expect(desiredEntry('legacy-3f9c1a2b7d', {})).toEqual({ name: 'legacy-3f9c1a2b7d', legacy: true })
  })
})

describe('createArgs', () => {
  it('passes chown, mode and path as storage:create takes them', () => {
    expect(createArgs(desiredEntry('uploads', {}))).toEqual(['storage:create', 'uploads', '--chown', 'herokuish'])
    expect(createArgs(desiredEntry('data', { chown: 1000, mode: '0750' }))).toEqual(['storage:create', 'data', '--chown', '1000', '--mode', '0750'])
    expect(createArgs(desiredEntry('media', { path: '/srv/media' }))).toEqual(['storage:create', 'media', '/srv/media'])
    expect(createArgs(desiredEntry('scratch', { chown: false }))).toEqual(['storage:create', 'scratch', '--chown', 'false'])
  })
})

describe('entryState', () => {
  it('compares a missing chown with the herokuish default', () => {
    const state = entryState(desiredEntry('uploads', {}), { name: 'uploads', scheduler: 'docker-local', host_path: '/var/lib/dokku/data/storage/uploads' })
    expect(state).toEqual({ kind: 'changed', chown: { server: '', want: 'herokuish' } })
  })

  it('compares the mode in 4-digit form', () => {
    const state = entryState(desiredEntry('data', { mode: '750' }), { scheduler: 'docker-local', ...entry('data', { mode: '0750' }) } as ServerEntry)
    expect(state).toEqual({ kind: 'ok' })
  })
})

describe('ensureVolumes', () => {
  let log: ReturnType<typeof vi.spyOn>
  let err: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => {})
    err = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })
  afterEach(() => vi.restoreAllMocks())

  it('creates a missing entry', async () => {
    const { ctx } = server([])
    const failed = await ensureVolumes(ctx, { uploads: {}, data: { chown: 1000, mode: '0750' }, media: { path: '/srv/media' } })
    expect(failed.size).toBe(0)
    expect(ctx.commands).toEqual([
      ['storage:create', 'uploads', '--chown', 'herokuish'],
      ['storage:create', 'data', '--chown', '1000', '--mode', '0750'],
      ['storage:create', 'media', '/srv/media'],
    ])
  })

  it('runs nothing for an entry in sync', async () => {
    const { ctx } = server([entry('uploads'), entry('data', { chown: '1000', mode: '0750' }), entry('media', { host_path: '/srv/media', chown: undefined })])
    await ensureVolumes(ctx, { uploads: {}, data: { chown: 1000, mode: '0750' }, media: { path: '/srv/media' } })
    expect(ctx.commands).toEqual([])
  })

  it('sets a differing chown, then a differing mode', async () => {
    const { ctx } = server([entry('data', { chown: 'root', mode: '0700' })])
    await ensureVolumes(ctx, { data: { chown: 1000, mode: '0750' } })
    expect(ctx.commands).toEqual([
      ['storage:set', 'data', 'chown', '1000'],
      ['storage:set', 'data', 'mode', '0750'],
    ])
  })

  it('chowns a hand-made entry without an owner to herokuish', async () => {
    const { ctx } = server([entry('uploads', { chown: undefined })])
    await ensureVolumes(ctx, { uploads: {} })
    expect(ctx.commands).toEqual([['storage:set', 'uploads', 'chown', 'herokuish']])
  })

  it('opts out with chown: false', async () => {
    const { ctx } = server([entry('scratch', { chown: 'herokuish' })])
    await ensureVolumes(ctx, { scratch: { chown: false } })
    expect(ctx.commands).toEqual([['storage:set', 'scratch', 'chown', 'false']])
  })

  it('leaves mode alone when the file does not declare it', async () => {
    const { ctx } = server([entry('uploads', { mode: '0777' })])
    await ensureVolumes(ctx, { uploads: {} })
    expect(ctx.commands).toEqual([])
  })

  it('never runs storage:create for an entry that exists, and reports a path that differs', async () => {
    const { ctx } = server([entry('media', { host_path: '/srv/old' }), entry('uploads', { chown: 'root' })])
    const failed = await ensureVolumes(ctx, { media: { path: '/srv/media' }, uploads: {} })
    expect([...failed.keys()]).toEqual(['media'])
    expect(failed.get('media')).toMatch(/is at \/srv\/old on the server but the file says \/srv\/media/)
    // the other entry still converged
    expect(ctx.commands).toEqual([['storage:set', 'uploads', 'chown', 'herokuish']])
    expect(err).toHaveBeenCalled()
  })

  it('reports an entry that is a k3s entry on the server', async () => {
    const { ctx } = server([{ name: 'uploads', scheduler: 'k3s' }])
    const failed = await ensureVolumes(ctx, { uploads: {} })
    expect(failed.get('uploads')).toMatch(/scheduler k3s/)
    expect(ctx.commands).toEqual([])
  })

  it('needs a legacy entry to exist and manages nothing about it', async () => {
    const present = server([{ name: 'legacy-3f9c1a2b7d', host_path: '/srv/x' }])
    expect((await ensureVolumes(present.ctx, { 'legacy-3f9c1a2b7d': {} })).size).toBe(0)
    expect(present.ctx.commands).toEqual([])

    const absent = server([])
    const failed = await ensureVolumes(absent.ctx, { 'legacy-3f9c1a2b7d': {} })
    expect(failed.get('legacy-3f9c1a2b7d')).toMatch(/made by Dokku/)
    expect(absent.ctx.commands).toEqual([])
  })

  it('stops at the first failure with failFast', async () => {
    const { ctx } = server([{ name: 'a', scheduler: 'k3s' }])
    await expect(ensureVolumes(ctx, { a: {}, b: {} }, true)).rejects.toThrow(/scheduler k3s/)
    expect(ctx.commands).toEqual([])
  })

  it('reads the entries once', async () => {
    const { ctx, runner } = server([])
    await ensureVolumes(ctx, { a: {}, b: {} })
    expect((runner.queryStrict as any).mock.calls.filter((c: string[]) => c[0] === 'storage:list-entries')).toHaveLength(1)
  })
})

describe('readEntries', () => {
  it('rejects output that is not a list', async () => {
    const { ctx } = fakeContext({ queries: { [LIST]: 'No storage entries registered' }, checks: {} })
    await expect(readEntries(ctx)).rejects.toThrow(/did not return JSON/)
  })
})
