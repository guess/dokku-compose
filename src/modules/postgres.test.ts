import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { ensurePostgres, ensurePostgresBackups, destroyPostgres, exportPostgres } from './postgres.js'

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

describe('ensurePostgresBackups', () => {
  const backup = {
    schedule: '0 * * * *',
    bucket: 'db-backups/api-db',
    auth: {
      access_key_id: 'KEY',
      secret_access_key: 'SECRET',
      region: 'auto',
      signature_version: 's3v4',
      endpoint: 'https://r2.example.com',
    },
  }

  it('configures backup when hash differs', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    runner.query = vi.fn().mockResolvedValue('')
    const ctx = createContext(runner)
    await ensurePostgresBackups(ctx, { 'api-db': { backup } })
    expect(runner.run).toHaveBeenCalledWith('postgres:backup-deauth', 'api-db')
    expect(runner.run).toHaveBeenCalledWith(
      'postgres:backup-auth', 'api-db', 'KEY', 'SECRET', 'auto', 's3v4', 'https://r2.example.com'
    )
    expect(runner.run).toHaveBeenCalledWith('postgres:backup-schedule', 'api-db', '0 * * * *', 'db-backups/api-db')
  })

  it('skips when hash matches', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    const { createHash } = await import('crypto')
    const hash = createHash('sha256').update(JSON.stringify(backup)).digest('hex')
    runner.query = vi.fn().mockResolvedValue(hash)
    const ctx = createContext(runner)
    await ensurePostgresBackups(ctx, { 'api-db': { backup } })
    expect(runner.run).not.toHaveBeenCalled()
  })

  it('skips entries without backup config', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensurePostgresBackups(ctx, { 'api-db': {} })
    expect(runner.run).not.toHaveBeenCalled()
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
