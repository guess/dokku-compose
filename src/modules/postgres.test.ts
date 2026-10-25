import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { ensurePostgres, destroyPostgres, exportPostgres, removeBackupHashKeys } from './postgres.js'
import { fakeContext, serviceInfoJson } from '../tests/fake-server.js'

describe('ensurePostgres', () => {
  it('creates service that does not exist', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensurePostgres(ctx, { 'api-db': {} })
    expect(runner.run).toHaveBeenCalledWith('postgres:create', 'api-db')
  })

  it('skips service that exists', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensurePostgres(ctx, { 'api-db': {} })
    expect(runner.run).not.toHaveBeenCalled()
  })

  it('passes --image and --image-version flags', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensurePostgres(ctx, { 'api-db': { image: 'postgis/postgis', version: '17-3.5' } })
    expect(runner.run).toHaveBeenCalledWith(
      'postgres:create', 'api-db', '--image', 'postgis/postgis', '--image-version', '17-3.5'
    )
  })
})

describe('removeBackupHashKeys', () => {
  it('warns and carries on when the global env cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { ctx, runner } = fakeContext({ checks: {}, queries: {} })
      await removeBackupHashKeys(ctx)
      expect(runner.dryRunLog).toEqual([])
      expect(warn.mock.calls.length).toBe(1)
    } finally { warn.mockRestore() }
  })

  it('unsets every old DOKKU_COMPOSE_BACKUP_HASH_* global, and a second run unsets none', async () => {
    const { ctx, runner } = fakeContext({ checks: {}, queries: {
      'config:export --global --format json': JSON.stringify({ APP_ENV: 'x', DOKKU_COMPOSE_BACKUP_HASH_WEB_DB: 'h', DOKKU_COMPOSE_BACKUP_HASH_API_DB: 'h' }),
    } })
    await removeBackupHashKeys(ctx)
    expect(runner.dryRunLog).toEqual([
      'config:unset --global --no-restart DOKKU_COMPOSE_BACKUP_HASH_API_DB DOKKU_COMPOSE_BACKUP_HASH_WEB_DB',
    ])
    const second = fakeContext({ checks: {}, queries: { 'config:export --global --format json': '{"APP_ENV":"x"}' } })
    await removeBackupHashKeys(second.ctx)
    expect(second.runner.dryRunLog).toEqual([])
  })
})

describe('destroyPostgres', () => {
  it('destroys existing service', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await destroyPostgres(ctx, { 'api-db': {} })
    expect(runner.run).toHaveBeenCalledWith('postgres:destroy', 'api-db', '--force')
  })
})

describe('exportPostgres', () => {
  it('exports with custom image', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'postgres:list') return 'NAME   VERSION   STATUS\napi-db postgis/postgis:17-3.5 running'
      if (args[0] === 'postgres:info') return '=====> api-db\n       Version:             postgis/postgis:17-3.5'
      return ''
    })
    const ctx = createContext(runner)
    const result = await exportPostgres(ctx)
    expect(result).toEqual({ 'api-db': { image: 'postgis/postgis', version: '17-3.5' } })
  })

  it('omits image when it matches default', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'postgres:list') return 'NAME   VERSION   STATUS\napi-db postgres:16 running'
      if (args[0] === 'postgres:info') return '=====> api-db\n       Version:             postgres:16'
      return ''
    })
    const ctx = createContext(runner)
    const result = await exportPostgres(ctx)
    expect(result).toEqual({ 'api-db': { version: '16' } })
  })

  it('exports backup schedule and bucket', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'postgres:list') return 'NAME   VERSION   STATUS\napi-db postgres:16 running'
      if (args[0] === 'postgres:info') return '=====> api-db\n       Version:             postgres:16'
      if (args[0] === 'postgres:backup-schedule-cat')
        return '0 * * * * dokku /usr/bin/dokku postgres:backup api-db db-backups/api-db'
      return ''
    })
    const ctx = createContext(runner)
    const result = await exportPostgres(ctx)
    expect(result['api-db'].backup).toEqual({
      schedule: '0 * * * *',
      bucket: 'db-backups/api-db',
      auth: {
        access_key_id: 'REPLACE_ME',
        secret_access_key: 'REPLACE_ME',
        region: 'REPLACE_ME',
        signature_version: 'REPLACE_ME',
        endpoint: 'REPLACE_ME',
      },
    })
  })

  it('omits backup when no schedule configured', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'postgres:list') return 'NAME   VERSION   STATUS\napi-db postgres:16 running'
      if (args[0] === 'postgres:info') return '=====> api-db\n       Version:             postgres:16'
      if (args[0] === 'postgres:backup-schedule-cat') throw new Error('exit code 1')
      return ''
    })
    const ctx = createContext(runner)
    const result = await exportPostgres(ctx)
    expect(result['api-db'].backup).toBeUndefined()
  })

  it('returns empty when no services', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('NAME   VERSION   STATUS')
    const ctx = createContext(runner)
    const result = await exportPostgres(ctx)
    expect(result).toEqual({})
  })
})
