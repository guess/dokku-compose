// src/resources/config.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createRunner, DokkuCommandError } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { reconcile } from '../core/reconcile.js'
import { Config } from './config.js'

describe('Config resource', () => {
  it('sets env vars and updates managed keys', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn()
      .mockResolvedValueOnce('')  // managed keys query (config:get DOKKU_COMPOSE_MANAGED_KEYS)
    runner.run = vi.fn()
    const ctx = createContext(runner)

    await reconcile(Config, ctx, 'myapp', { SECRET: 'abc', PORT: '3000' })
    const setCmds = ctx.commands.filter(c => c[0] === 'config:set')
    expect(setCmds.length).toBe(1)
    expect(setCmds[0]).toContain('SECRET=abc')
    expect(setCmds[0]).toContain('PORT=3000')
  })

  it('unsets keys removed from desired', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn()
      .mockResolvedValueOnce('OLD_KEY,KEEP_KEY')  // managed keys
    runner.queryStrict = vi.fn()
      .mockResolvedValueOnce("export OLD_KEY='x'\nexport KEEP_KEY='y'\nexport DOKKU_COMPOSE_MANAGED_KEYS='OLD_KEY,KEEP_KEY'\n")
    runner.run = vi.fn()
    const ctx = createContext(runner)

    await reconcile(Config, ctx, 'myapp', { KEEP_KEY: 'y' })
    const unsetCmds = ctx.commands.filter(c => c[0] === 'config:unset')
    expect(unsetCmds.length).toBe(1)
    expect(unsetCmds[0]).toContain('OLD_KEY')
  })

  function managed(exportOut: string) {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValueOnce('A,B')
    runner.queryStrict = vi.fn().mockResolvedValueOnce(exportOut)
    runner.run = vi.fn()
    return { runner, ctx: createContext(runner) }
  }
  const EXPORT = "export A='1'\nexport B='2'\nexport OTHER='keep'\nexport DOKKU_COMPOSE_MANAGED_KEYS='A,B'\n"

  it('removing the whole env block unsets every managed key and the marker, leaving others', async () => {
    const { runner, ctx } = managed(EXPORT)
    await reconcile(Config, ctx, 'myapp', {})
    expect(runner.run).toHaveBeenCalledWith('config:unset', '--no-restart', 'myapp', 'A', 'B')
    expect(runner.run).toHaveBeenCalledWith('config:unset', '--no-restart', 'myapp', 'DOKKU_COMPOSE_MANAGED_KEYS')
    expect(ctx.commands.some(c => c[0] === 'config:set')).toBe(false)
    expect(ctx.commands.flat()).not.toContain('OTHER')
  })

  it('does nothing for an empty env when there is no marker', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
    runner.queryStrict = vi.fn()
    runner.run = vi.fn()
    await reconcile(Config, createContext(runner), 'myapp', {})
    expect(runner.run).not.toHaveBeenCalled()
  })

  it('surfaces a rejected config:unset and keeps the marker', async () => {
    const { runner, ctx } = managed(EXPORT)
    runner.run = vi.fn().mockRejectedValue(new DokkuCommandError(['config:unset', '--no-restart', 'myapp', 'B'], 1, 'boom'))
    await expect(reconcile(Config, ctx, 'myapp', { A: '1' })).rejects.toThrow(/config:unset --no-restart myapp B failed/)
    expect(runner.run).toHaveBeenCalledTimes(1)
    expect(ctx.commands.some(c => c.join(' ').includes('DOKKU_COMPOSE_MANAGED_KEYS'))).toBe(false)
  })

  it('errors when config:export fails instead of treating env as empty', async () => {
    const { runner, ctx } = managed('')
    runner.queryStrict = vi.fn().mockRejectedValue(new DokkuCommandError(['config:export', 'myapp'], 1, 'no'))
    await expect(reconcile(Config, ctx, 'myapp', { A: '1' })).rejects.toThrow(/config:export/)
    expect(runner.run).not.toHaveBeenCalled()
  })

  it('removes a stale marker when every marked key is already gone', async () => {
    const { runner, ctx } = managed("export OTHER='keep'\n")
    await reconcile(Config, ctx, 'myapp', {})
    expect(runner.run).toHaveBeenCalledWith('config:unset', '--no-restart', 'myapp', 'DOKKU_COMPOSE_MANAGED_KEYS')
  })
})
