import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { ensureRedis, destroyRedis, exportRedis } from './redis.js'
import { serviceInfoJson } from '../tests/fake-server.js'

describe('ensureRedis', () => {
  it('creates service that does not exist', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    expect([...await ensureRedis(ctx, { 'api-cache': {} })]).toEqual(['api-cache'])
    expect(runner.run).toHaveBeenCalledWith('redis:create', 'api-cache')
  })

  it('skips service that exists', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensureRedis(ctx, { 'api-cache': {} })
    expect(runner.run).not.toHaveBeenCalled()
  })

  it('passes --image-version flag', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensureRedis(ctx, { 'api-cache': { version: '7.2-alpine' } })
    expect(runner.run).toHaveBeenCalledWith('redis:create', 'api-cache', '--image-version', '7.2-alpine')
  })
})

describe('destroyRedis', () => {
  it('destroys existing service', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await destroyRedis(ctx, { 'api-cache': {} })
    expect(runner.run).toHaveBeenCalledWith('redis:destroy', 'api-cache', '--force')
  })
})

describe('exportRedis', () => {
  it('exports redis services with version', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'redis:list') return 'NAME   VERSION   STATUS\napi-cache redis:7.2-alpine running'
      if (args[0] === 'redis:info') return '=====> api-cache\n       Version:             redis:7.2-alpine'
      return ''
    })
    runner.queryStrict = vi.fn().mockResolvedValue(serviceInfoJson('api-cache', 'redis', '7.2-alpine'))
    const ctx = createContext(runner)
    const result = await exportRedis(ctx)
    expect(result).toEqual({ 'api-cache': { version: '7.2-alpine' } })
  })

  it('exports the backup of a service, with REPLACE_ME for its secrets', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'redis:list') return 'NAME   VERSION   STATUS\napi-cache redis:7.2-alpine running'
      if (args[0] === 'redis:info') return '=====> api-cache\n       Version:             redis:7.2-alpine'
      return ''
    })
    runner.queryStrict = vi.fn().mockResolvedValue(serviceInfoJson('api-cache', 'redis', '7.2-alpine', {
      'backup-schedule': '0 * * * *', 'backup-bucket': 'cache-backups/api-cache', 'backup-encryption-fingerprint': 'abc',
    }))
    const result = await exportRedis(createContext(runner))
    expect(result['api-cache'].backup).toMatchObject({
      schedule: '0 * * * *', bucket: 'cache-backups/api-cache', encryption: { passphrase: 'REPLACE_ME' },
      auth: { access_key_id: 'REPLACE_ME', secret_access_key: 'REPLACE_ME' },
    })
  })

  it('returns empty when no services', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('NAME   VERSION   STATUS')
    const ctx = createContext(runner)
    const result = await exportRedis(ctx)
    expect(result).toEqual({})
  })
})
