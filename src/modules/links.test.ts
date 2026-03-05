import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { resolveServicePlugin, ensureAppLinks, destroyAppLinks, exportAppLinks } from './links.js'
import type { Config } from '../core/schema.js'

describe('resolveServicePlugin', () => {
  it('finds postgres service', () => {
    const config = { apps: {}, postgres: { 'api-db': {} }, redis: { 'api-cache': {} } } as Config
    expect(resolveServicePlugin('api-db', config)).toEqual({ plugin: 'postgres', config: {} })
  })

  it('finds redis service', () => {
    const config = { apps: {}, postgres: { 'api-db': {} }, redis: { 'api-cache': {} } } as Config
    expect(resolveServicePlugin('api-cache', config)).toEqual({ plugin: 'redis', config: {} })
  })

  it('returns undefined for unknown service', () => {
    const config = { apps: {} } as Config
    expect(resolveServicePlugin('unknown', config)).toBeUndefined()
  })
})

describe('ensureAppLinks', () => {
  it('links desired services not yet linked', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    const config = { apps: {}, postgres: { 'api-db': {} } } as Config
    await ensureAppLinks(ctx, 'myapp', ['api-db'], config)
    expect(runner.run).toHaveBeenCalledWith('postgres:link', 'api-db', 'myapp', '--no-restart')
  })

  it('unlinks services not in desired list', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    const config = { apps: {}, postgres: { 'api-db': {} } } as Config
    await ensureAppLinks(ctx, 'myapp', [], config)
    expect(runner.run).toHaveBeenCalledWith('postgres:unlink', 'api-db', 'myapp', '--no-restart')
  })
})

describe('destroyAppLinks', () => {
  it('unlinks specified services', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    const config = { apps: {}, postgres: { 'api-db': {} } } as Config
    await destroyAppLinks(ctx, 'myapp', ['api-db'], config)
    expect(runner.run).toHaveBeenCalledWith('postgres:unlink', 'api-db', 'myapp', '--no-restart')
  })
})

describe('exportAppLinks', () => {
  it('returns linked service names', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockImplementation(async (...args: string[]) =>
      args[0] === 'postgres:linked' ? true : false
    )
    const ctx = createContext(runner)
    const config = { apps: {}, postgres: { 'api-db': {} }, redis: { 'api-cache': {} } } as Config
    const result = await exportAppLinks(ctx, 'myapp', config)
    expect(result).toEqual(['api-db'])
  })
})
