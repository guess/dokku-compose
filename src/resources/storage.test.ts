import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { reconcile } from '../core/reconcile.js'
import { fakeContext, storageReportJson, type FakeAttachment } from '../tests/fake-server.js'
import { Storage, desiredSpecs, formatSpec, parseSpec, parseAttachments } from './storage.js'

const LIST = 'storage:list-entries --format json'
const entry = (name: string, host_path: string) => ({ name, scheduler: 'docker-local', host_path })

function box(attachments: FakeAttachment[], entries: { name: string; scheduler: string; host_path: string }[] = []) {
  return fakeContext({
    queries: { 'storage:report myapp --format json': storageReportJson(attachments), [LIST]: JSON.stringify(entries) },
    checks: { 'apps:exists myapp': true },
  })
}

const att = (entry: string, hostPath: string, containerPath: string, rest: Partial<FakeAttachment> = {}): FakeAttachment =>
  ({ entry, hostPath, containerPath, ...rest })

beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(process.stdout, 'write').mockImplementation(() => true) })
afterEach(() => vi.restoreAllMocks())

describe('specs', () => {
  it('round-trips every token', () => {
    for (const spec of [
      'uploads:/app/uploads',
      'data:/app/data:ro',
      'data:/app/data:ro,phase=deploy,Z,noexec',
      'worker=media:/app/media:Z',
      'media:/app/media:phase=run',
      'legacy-3f9c:/x:volume-subpath=sub,volume-chown=herokuish',
    ]) {
      expect(formatSpec(parseSpec(spec))).toBe(spec)
    }
  })

  it('writes both phases as no token', () => {
    expect(desiredSpecs([{ entry: 'a', container_dir: '/a', phases: ['run', 'deploy'] }])).toEqual(['a:/a'])
    expect(desiredSpecs([{ entry: 'a', container_dir: '/a', phases: ['run'] }])).toEqual(['a:/a:phase=run'])
  })

  it('has no desired value without a storage key', () => {
    expect(desiredSpecs(undefined)).toBeUndefined()
    expect(desiredSpecs([])).toEqual([])
  })

  it('reads mixed short and map forms', () => {
    expect(desiredSpecs(['uploads:/app/uploads', { entry: 'media', container_dir: '/m', process_type: 'worker', readonly: true, options: ['Z'] }]))
      .toEqual(['uploads:/app/uploads', 'worker=media:/m:ro,Z'])
  })
})

describe('parseAttachments', () => {
  it('reads the attachment.<n>.* keys in numeric order and ignores the storage-attachment.* copies', () => {
    const many = Array.from({ length: 11 }, (_, i) => att(`e${i + 1}`, `/h${i + 1}`, `/c${i + 1}`))
    expect(parseAttachments(storageReportJson(many)).map(s => s.split(':')[0])).toEqual(many.map(a => a.entry))
  })

  it('reads every field', () => {
    expect(parseAttachments(storageReportJson([
      att('data', '/d', '/app/data', { phases: 'deploy', readonly: true, volumeOptions: 'Z,noexec', processType: 'worker', subpath: 'x', volumeChown: 'root' }),
    ]))).toEqual(['worker=data:/app/data:ro,phase=deploy,Z,noexec,volume-subpath=x,volume-chown=root'])
  })

  it('reads no attachments', () => {
    expect(parseAttachments(storageReportJson([]))).toEqual([])
  })

  it('rejects a report that is not JSON', () => {
    expect(() => parseAttachments('=====> myapp storage information')).toThrow(/did not return JSON/)
  })
})

describe('Storage.read', () => {
  it('plans from nothing for an app that does not exist yet', async () => {
    const { ctx } = fakeContext({ queries: {}, checks: { 'apps:exists newapp': false } })
    expect(await Storage.read(ctx, 'newapp')).toEqual([])
  })

  it('does not hide a failed read on an app that exists', async () => {
    const { ctx } = fakeContext({ queries: {}, checks: { 'apps:exists myapp': true } })
    await expect(Storage.read(ctx, 'myapp')).rejects.toThrow(/no answer/)
  })
})

describe('mounting', () => {
  it('writes the default scope with one --replace call', async () => {
    const { ctx } = box([])
    await reconcile(Storage, ctx, 'myapp', ['uploads:/app/uploads', 'data:/app/data:ro,phase=deploy,Z'])
    expect(ctx.commands).toEqual([['storage:mount', '--replace', 'myapp', 'uploads:/app/uploads', 'data:/app/data:ro,phase=deploy,Z']])
    expect(ctx.restarts.get('myapp')).toEqual(['storage'])
  })

  it('runs nothing when the mounts match, in any order', async () => {
    const { ctx } = box([att('a', '/a', '/x'), att('b', '/b', '/y', { readonly: true })], [entry('a', '/a'), entry('b', '/b')])
    await reconcile(Storage, ctx, 'myapp', ['b:/y:ro', 'a:/x'])
    expect(ctx.commands).toEqual([])
    expect(ctx.restarts.size).toBe(0)
  })

  it('gives a named process type its own call with --process-type', async () => {
    const { ctx } = box([])
    await reconcile(Storage, ctx, 'myapp', ['uploads:/app/uploads', 'worker=scratch:/scratch', 'worker=cache:/cache'])
    expect(ctx.commands).toEqual([
      ['storage:mount', '--replace', 'myapp', 'uploads:/app/uploads'],
      ['storage:mount', '--replace', 'myapp', 'scratch:/scratch', 'cache:/cache', '--process-type', 'worker'],
    ])
  })

  it('touches only the scope that differs', async () => {
    const { ctx } = box([att('a', '/a', '/x'), att('s', '/s', '/s', { processType: 'worker' })], [entry('a', '/a'), entry('s', '/s'), entry('t', '/t')])
    await reconcile(Storage, ctx, 'myapp', ['a:/x', 'worker=t:/s'])
    expect(ctx.commands).toEqual([['storage:mount', '--replace', 'myapp', 't:/s', '--process-type', 'worker']])
  })

  it('removes a scope the file no longer declares with unmount --all', async () => {
    const { ctx } = box([att('a', '/a', '/x'), att('s', '/s', '/s', { processType: 'worker' })], [entry('a', '/a'), entry('s', '/s')])
    await reconcile(Storage, ctx, 'myapp', ['a:/x'])
    expect(ctx.commands).toEqual([['storage:unmount', '--all', 'myapp', '--process-type', 'worker']])
    expect(ctx.restarts.get('myapp')).toEqual(['storage'])
  })

  it('removes every mount for an empty list in one call', async () => {
    const { ctx } = box([att('a', '/a', '/x'), att('s', '/s', '/s', { processType: 'worker' })], [entry('a', '/a'), entry('s', '/s')])
    await reconcile(Storage, ctx, 'myapp', [])
    expect(ctx.commands).toEqual([['storage:unmount', '--all', 'myapp']])
  })

  it('clears a subpath or chown left on the server, without a restart', async () => {
    const { ctx } = box([att('a', '/a', '/x', { subpath: 'sub', volumeChown: 'root' })], [entry('a', '/a')])
    await reconcile(Storage, ctx, 'myapp', ['a:/x'])
    expect(ctx.commands).toEqual([['storage:mount', '--replace', 'myapp', 'a:/x']])
    expect(ctx.restarts.size).toBe(0)
  })

  it('compares options and read-only', async () => {
    const { ctx } = box([att('a', '/a', '/x', { volumeOptions: 'Z' })], [entry('a', '/a')])
    await reconcile(Storage, ctx, 'myapp', ['a:/x:Z,noexec'])
    expect(ctx.commands).toHaveLength(1)
    expect(ctx.restarts.get('myapp')).toEqual(['storage'])
  })
})

describe('moving off a legacy entry', () => {
  const legacy = 'legacy-3f9c1a2b7d'

  it('swaps in one --replace and needs no restart when the host path is the same', async () => {
    const { ctx } = box(
      [att(legacy, '/srv/uploads', '/app/uploads')],
      [entry(legacy, '/srv/uploads'), entry('uploads', '/srv/uploads')],
    )
    await reconcile(Storage, ctx, 'myapp', ['uploads:/app/uploads'])
    expect(ctx.commands).toEqual([['storage:mount', '--replace', 'myapp', 'uploads:/app/uploads']])
    expect(ctx.restarts.size).toBe(0)
  })

  it('needs a restart when the host path is not the same', async () => {
    const { ctx } = box(
      [att(legacy, '/srv/uploads', '/app/uploads')],
      [entry(legacy, '/srv/uploads'), entry('uploads', '/var/lib/dokku/data/storage/uploads')],
    )
    await reconcile(Storage, ctx, 'myapp', ['uploads:/app/uploads'])
    expect(ctx.restarts.get('myapp')).toEqual(['storage'])
  })

  it('treats a migrated deploy-only mount as drift against the default of both phases', async () => {
    const { ctx } = box(
      [att(legacy, '/srv/uploads', '/app/uploads', { phases: 'deploy' })],
      [entry(legacy, '/srv/uploads'), entry('uploads', '/srv/uploads')],
    )
    await reconcile(Storage, ctx, 'myapp', ['uploads:/app/uploads'])
    expect(ctx.commands).toHaveLength(1)
    expect(ctx.restarts.get('myapp')).toEqual(['storage'])
  })

  it('keeps a deploy-only mount in sync when the file says phases: [deploy]', async () => {
    const { ctx } = box(
      [att('uploads', '/srv/uploads', '/app/uploads', { phases: 'deploy' })],
      [entry('uploads', '/srv/uploads')],
    )
    await reconcile(Storage, ctx, 'myapp', ['uploads:/app/uploads:phase=deploy'])
    expect(ctx.commands).toEqual([])
  })

  it('plans a restart when the entry does not exist yet (--dry-run)', async () => {
    const { ctx } = box([att(legacy, '/srv/uploads', '/app/uploads')], [entry(legacy, '/srv/uploads')])
    await reconcile(Storage, ctx, 'myapp', ['uploads:/app/uploads'])
    expect(ctx.restarts.get('myapp')).toEqual(['storage'])
  })
})

describe('order of scopes', () => {
  it('frees a container dir before another scope claims it', async () => {
    // /x moves from the worker scope to the default scope: worker must go first.
    const { ctx } = box([att('a', '/a', '/x', { processType: 'worker' })], [entry('a', '/a'), entry('b', '/b')])
    await reconcile(Storage, ctx, 'myapp', ['b:/x'])
    expect(ctx.commands).toEqual([
      ['storage:unmount', '--all', 'myapp', '--process-type', 'worker'],
      ['storage:mount', '--replace', 'myapp', 'b:/x'],
    ])
  })

  it('and the other way round', async () => {
    // /x moves from the default scope to the worker scope: default must be written first.
    const { ctx } = box([att('a', '/a', '/x')], [entry('a', '/a'), entry('b', '/b')])
    await reconcile(Storage, ctx, 'myapp', ['worker=b:/x', 'a:/y'])
    expect(ctx.commands).toEqual([
      ['storage:mount', '--replace', 'myapp', 'a:/y'],
      ['storage:mount', '--replace', 'myapp', 'b:/x', '--process-type', 'worker'],
    ])
  })

  it('stops on a swap no order can do', async () => {
    const { ctx } = box(
      [att('a', '/a', '/x', { processType: 'web' }), att('b', '/b', '/y')],
      [entry('a', '/a'), entry('b', '/b')],
    )
    await expect(reconcile(Storage, ctx, 'myapp', ['b:/x', 'web=a:/y'])).rejects.toThrow(/Apply the change in two runs/)
    expect(ctx.commands).toEqual([])
  })
})
