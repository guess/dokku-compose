import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { ensureAppConfig } from './config.js'

describe('ensureAppConfig', () => {
  it('sets env vars with managed keys tracking', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')  // no managed keys yet
    runner.run = vi.fn()
    await ensureAppConfig(runner, 'myapp', { SECRET_KEY: 'abc', PORT: '3000' })
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
    const desired = { APP_KEEP: 'value' }
    await ensureAppConfig(runner, 'myapp', desired)
    expect(runner.run).toHaveBeenCalledWith(
      'config:unset', '--no-restart', 'myapp', 'APP_OLD'
    )
  })

  it('never touches Dokku-injected vars not in managed set', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')  // no managed keys
    runner.run = vi.fn()
    await ensureAppConfig(runner, 'myapp', { MY_KEY: 'value' })
    const calls = (runner.run as any).mock.calls.map((c: string[]) => c.join(' '))
    expect(calls.some((c: string) => c.includes('DATABASE_URL'))).toBe(false)
  })

  it('skips when env is false', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn()
    runner.run = vi.fn()
    await ensureAppConfig(runner, 'myapp', false)
    expect(runner.run).not.toHaveBeenCalled()
  })
})
