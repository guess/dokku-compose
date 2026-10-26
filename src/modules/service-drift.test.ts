import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { readServiceMismatches } from './service-drift.js'
import { serviceInfoJson } from '../tests/fake-server.js'
import { computeDiff } from '../commands/diff.js'
import type { Config } from '../core/schema.js'

function ctxWith(info: string | Error) {
  const runner = createRunner({ dryRun: true })
  runner.queryStrict = vi.fn(async () => { if (info instanceof Error) throw info; return info })
  runner.check = vi.fn(async () => true)
  runner.query = vi.fn(async () => 'dokku version 0.38.32')
  return { ctx: createContext(runner), runner }
}

describe('readServiceMismatches', () => {
  it('reads postgres info as json and reports a changed version', async () => {
    const { ctx, runner } = ctxWith(serviceInfoJson('db', 'postgres', '16.1'))
    const m = await readServiceMismatches(ctx, 'postgres', 'db', { version: '17.0' })
    expect(m).toEqual([{ field: 'version', desired: '17.0', current: '16.1' }])
    expect(runner.queryStrict).toHaveBeenCalledWith('postgres:info', 'db', '--format', 'json')
  })

  it('treats a declared default image as equal to the server default (redis)', async () => {
    const { ctx } = ctxWith(serviceInfoJson('c', 'redis', '7.2-alpine'))
    expect(await readServiceMismatches(ctx, 'redis', 'c', { image: 'redis', version: '7.2-alpine' })).toEqual([])
  })

  it('reports a custom image that differs', async () => {
    const { ctx } = ctxWith(serviceInfoJson('db', 'postgres', '17-3.5'))
    expect(await readServiceMismatches(ctx, 'postgres', 'db', { image: 'postgis/postgis' }))
      .toEqual([{ field: 'image', desired: 'postgis/postgis', current: 'postgres' }])
  })

  it('never reads or drifts when neither field is declared', async () => {
    const { ctx, runner } = ctxWith(new Error('must not be read'))
    expect(await readServiceMismatches(ctx, 'redis', 'c', {})).toEqual([])
    expect(runner.queryStrict).not.toHaveBeenCalled()
  })

  it('throws when the output is not json', async () => {
    const { ctx } = ctxWith('=====> info')
    await expect(readServiceMismatches(ctx, 'redis', 'c', { version: '1' })).rejects.toThrow('did not return JSON')
  })
})

describe('diff of a service', () => {
  const config = { apps: {}, postgres: { db: { version: '17.0' } } } as unknown as Config
  it('is changed and not in sync on a version change', async () => {
    const { ctx } = ctxWith(serviceInfoJson('db', 'postgres', '16.1'))
    const diff = await computeDiff(ctx, config)
    expect(diff.services.db.status).toBe('changed')
    expect(diff.inSync).toBe(false)
  })
  it('is unknown, with a read warning, when the read fails', async () => {
    const { ctx } = ctxWith(new Error('boom'))
    const diff = await computeDiff(ctx, config)
    expect(diff.services.db.status).toBe('unknown')
    expect(diff.readWarnings[0]).toContain('boom')
    expect(diff.inSync).toBe(false)
  })
  it('stays in sync, with a read warning, when a redis service that declares nothing cannot be read', async () => {
    const { ctx } = ctxWith(new Error('boom'))
    const diff = await computeDiff(ctx, { apps: {}, redis: { cache: {} } } as unknown as Config)
    expect(diff.services.cache.status).toBe('in-sync')
    expect(diff.readWarnings.some(w => w.includes("redis service 'cache'") && w.includes('boom'))).toBe(true)
  })
  it('stays in sync, with a read warning, when a postgres service that declares nothing cannot be read', async () => {
    const { ctx } = ctxWith(new Error('boom'))
    const diff = await computeDiff(ctx, { apps: {}, postgres: { db: {} } } as unknown as Config)
    expect(diff.services.db.status).toBe('in-sync')
    // The note read is best effort: a warning, but the service itself is not drift.
    expect(diff.readWarnings.some(w => w.includes("postgres service 'db'") && w.includes('boom'))).toBe(true)
  })
})
