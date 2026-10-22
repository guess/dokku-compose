import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { readLinkOptions, linkEnvVar, resolveServicePlugin, ensureAppLinks, destroyAppLinks, exportAppLinks } from './links.js'
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

describe('link options', () => {
  const config = { apps: {}, postgres: { 'api-db': {} }, redis: { cache: {} } } as Config
  const pgOnly = { apps: {}, postgres: { 'api-db': {} } } as Config

  it('passes alias, env_var and querystring to :link', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.run = vi.fn()
    await ensureAppLinks(createContext(runner), 'myapp', [
      { service: 'api-db', alias: 'BLUE_DB', querystring: 'sslmode=require' },
      { service: 'cache', env_var: 'CACHE_CONN' },
    ], config)
    expect(runner.run).toHaveBeenCalledWith('postgres:link', 'api-db', 'myapp', '--no-restart', '--alias', 'BLUE_DB', '--querystring', 'sslmode=require')
    expect(runner.run).toHaveBeenCalledWith('redis:link', 'cache', 'myapp', '--no-restart', '--env-var', 'CACHE_CONN')
  })

  it('unlinks then links when the linked variable carries a different querystring, and returns the service', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)
    runner.queryStrict = vi.fn().mockResolvedValue(JSON.stringify({ BLUE_DB_URL: 'postgres://u:p@dokku-postgres-api-db:5432/db?a=1' }))
    runner.run = vi.fn()
    await ensureAppLinks(createContext(runner), 'myapp', [{ service: 'api-db', alias: 'BLUE_DB', querystring: 'a=2' }], pgOnly)
    expect((runner.run as any).mock.calls.map((c: string[]) => c.join(' '))).toEqual([
      'postgres:unlink api-db myapp --no-restart',
      'postgres:link api-db myapp --no-restart --alias BLUE_DB --querystring a=2',
    ])
  })

  it('does nothing when the options match', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)
    runner.queryStrict = vi.fn().mockResolvedValue(JSON.stringify({ BLUE_DB_URL: 'postgres://u:p@dokku-postgres-api-db:5432/db?a=2' }))
    runner.run = vi.fn()
    await ensureAppLinks(createContext(runner), 'myapp', [{ service: 'api-db', alias: 'BLUE_DB', querystring: 'a=2' }], pgOnly)
    expect(runner.run).not.toHaveBeenCalled()
  })

  it('treats an unreadable env as unknown, not drift', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)
    runner.queryStrict = vi.fn().mockRejectedValue(new Error('boom'))
    runner.run = vi.fn()
    await ensureAppLinks(createContext(runner), 'myapp', [{ service: 'api-db', alias: 'BLUE_DB' }], pgOnly)
    expect(runner.run).not.toHaveBeenCalled()
  })

  const PG = 'postgres://u:p@dokku-postgres-api-db:5432/db'
  function server(env: Record<string, string>, run = vi.fn()) {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)
    runner.queryStrict = vi.fn().mockResolvedValue(JSON.stringify(env))
    runner.run = run
    return runner
  }
  const calls = (r: any) => r.run.mock.calls.map((c: string[]) => c.join(' '))

  it('a plain link whose URL sits under an alias relinks to the default name', async () => {
    const runner = server({ BLUE_URL: PG })
    const ctx = createContext(runner)
    await ensureAppLinks(ctx, 'myapp', ['api-db'], pgOnly)
    expect(ctx.restarts.get('myapp')).toEqual(['links'])
    expect(calls(runner)).toEqual(['postgres:unlink api-db myapp --no-restart', 'postgres:link api-db myapp --no-restart'])
  })

  it('a plain link at the default name runs nothing', async () => {
    const runner = server({ DATABASE_URL: PG })
    await ensureAppLinks(createContext(runner), 'myapp', ['api-db'], pgOnly)
    expect(calls(runner)).toEqual([])
  })

  it('two plain links of one plugin (the second on a DOKKU_ name) are in sync and export as plain', async () => {
    const two = { apps: {}, postgres: { 'api-db': {}, 'reports-db': {} } } as Config
    const runner = server({
      DATABASE_URL: PG,
      DOKKU_POSTGRES_AQUA_URL: 'postgres://u:p@dokku-postgres-reports-db:5432/db',
    })
    await ensureAppLinks(createContext(runner), 'myapp', ['api-db', 'reports-db'], two)
    expect(calls(runner)).toEqual([])
    expect(await exportAppLinks(createContext(runner), 'myapp', two)).toEqual(['api-db', 'reports-db'])
  })

  it('a plain link whose DATABASE_URL was set by hand lands on a DOKKU_ name and is in sync', async () => {
    const runner = server({ DATABASE_URL: 'postgres://elsewhere/db', DOKKU_POSTGRES_AQUA_URL: PG })
    await ensureAppLinks(createContext(runner), 'myapp', ['api-db'], pgOnly)
    expect(calls(runner)).toEqual([])
  })

  it('a same-named variable pointing elsewhere is not the link', async () => {
    const runner = server({ DATABASE_URL: 'postgres://u:p@somewhere-else:5432/db' })
    const state = await readLinkOptions(createContext(runner), 'myapp', 'postgres', { service: 'api-db' })
    expect(state.state).toBe('unreadable')
    await ensureAppLinks(createContext(runner), 'myapp', ['api-db'], pgOnly)
    expect(calls(runner)).toEqual([])
  })

  it('a same-named hand-set variable beside the real link does not hide a wrong name', async () => {
    const runner = server({ DATABASE_URL: 'postgres://u:p@somewhere-else/db', BLUE_URL: PG })
    const state = await readLinkOptions(createContext(runner), 'myapp', 'postgres', { service: 'api-db' })
    expect(state).toMatchObject({ state: 'differs', current: 'BLUE_URL', desired: 'DATABASE_URL' })
  })

  it('masks a sensitive querystring value in what it shows', async () => {
    const runner = server({ DATABASE_URL: PG + '?token=abcdefgh' })
    const state = await readLinkOptions(createContext(runner), 'myapp', 'postgres', { service: 'api-db', querystring: 'a=1' })
    expect(state).toMatchObject({ current: 'DATABASE_URL?token=****efgh', desired: 'DATABASE_URL?a=1' })
  })

  it('says the app is unlinked when the link fails after the unlink', async () => {
    const run = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('refused'))
    const runner = server({ BLUE_URL: PG }, run)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(ensureAppLinks(createContext(runner), 'myapp', ['api-db'], pgOnly)).rejects.toThrow('refused')
    expect(warn.mock.calls.flat().join('\n')).toContain('myapp is now unlinked from api-db')
    warn.mockRestore()
  })

  it('exports the object form when the variable or querystring is not the default', async () => {
    const runner = server({ BLUE_URL: PG + '?a=1' })
    expect(await exportAppLinks(createContext(runner), 'myapp', pgOnly)).toEqual([{ service: 'api-db', alias: 'BLUE', querystring: 'a=1' }])
    expect(await exportAppLinks(createContext(server({ DATABASE_URL: PG })), 'myapp', pgOnly)).toEqual(['api-db'])
    expect(await exportAppLinks(createContext(server({ MB_URI: PG })), 'myapp', pgOnly)).toEqual([{ service: 'api-db', env_var: 'MB_URI' }])
  })

  it('names the variable a link sets', () => {
    expect(linkEnvVar('postgres', { service: 's' })).toBe('DATABASE_URL')
    expect(linkEnvVar('redis', { service: 's' })).toBe('REDIS_URL')
    expect(linkEnvVar('postgres', { service: 's', alias: 'BLUE' })).toBe('BLUE_URL')
    expect(linkEnvVar('postgres', { service: 's', env_var: 'MB_URI' })).toBe('MB_URI')
  })
})
