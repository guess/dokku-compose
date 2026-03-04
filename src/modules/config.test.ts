import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { ensureAppConfig, exportAppConfig } from './config.js'

describe('ensureAppConfig', () => {
  it('sets env vars with managed keys tracking', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')  // no managed keys yet
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensureAppConfig(ctx, 'myapp', { SECRET_KEY: 'abc', PORT: '3000' })
    expect(runner.run).toHaveBeenCalledWith(
      'config:set', '--no-restart', 'myapp',
      'SECRET_KEY=abc', 'PORT=3000',
      expect.stringContaining('DOKKU_COMPOSE_MANAGED_KEYS=')
    )
  })

  it('unsets keys that were managed last run but removed from YAML', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('APP_OLD,APP_KEEP')  // prev managed keys
    runner.run = vi.fn()
    const ctx = createContext(runner)
    const desired = { APP_KEEP: 'value' }
    await ensureAppConfig(ctx, 'myapp', desired)
    expect(runner.run).toHaveBeenCalledWith(
      'config:unset', '--no-restart', 'myapp', 'APP_OLD'
    )
  })

  it('never touches Dokku-injected vars not in managed set', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')  // no managed keys
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensureAppConfig(ctx, 'myapp', { MY_KEY: 'value' })
    const calls = (runner.run as any).mock.calls.map((c: string[]) => c.join(' '))
    expect(calls.some((c: string) => c.includes('DATABASE_URL'))).toBe(false)
  })

  it('skips when env is false', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn()
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensureAppConfig(ctx, 'myapp', false)
    expect(runner.run).not.toHaveBeenCalled()
  })
})

describe('exportAppConfig', () => {
  it('returns parsed env vars excluding managed keys var', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue(
      "export SECRET_KEY='abc'\nexport PORT='3000'\nexport DOKKU_COMPOSE_MANAGED_KEYS='SECRET_KEY,PORT'"
    )
    const ctx = createContext(runner)
    const result = await exportAppConfig(ctx, 'myapp')
    expect(result).toEqual({ SECRET_KEY: 'abc', PORT: '3000' })
  })

  it('returns undefined when no config', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
    const ctx = createContext(runner)
    const result = await exportAppConfig(ctx, 'myapp')
    expect(result).toBeUndefined()
  })
})
