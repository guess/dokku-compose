import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { exportAppConfig } from './config.js'

describe('exportAppConfig', () => {
  it('returns parsed env vars excluding managed keys var', async () => {
    const runner = createRunner({ dryRun: false })
    runner.queryStrict = vi.fn().mockResolvedValue(
      '{"SECRET_KEY":"abc","PORT":"3000","DOKKU_COMPOSE_MANAGED_KEYS":"SECRET_KEY,PORT"}'
    )
    const ctx = createContext(runner)
    const result = await exportAppConfig(ctx, 'myapp')
    expect(result).toEqual({ SECRET_KEY: 'abc', PORT: '3000' })
  })

  it('returns undefined when no config', async () => {
    const runner = createRunner({ dryRun: false })
    runner.queryStrict = vi.fn().mockResolvedValue('{}')
    const ctx = createContext(runner)
    const result = await exportAppConfig(ctx, 'myapp')
    expect(result).toBeUndefined()
  })

  it('throws on non-JSON output (e.g. the one-line shell format)', async () => {
    const runner = createRunner({ dryRun: false })
    runner.queryStrict = vi.fn().mockResolvedValue("A='1' B='2'")
    await expect(exportAppConfig(createContext(runner), 'myapp')).rejects.toThrow(/did not return JSON/)
  })
})
