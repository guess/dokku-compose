import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { ensureAppLogs, exportAppLogs } from './logs.js'

describe('ensureAppLogs', () => {
  it('sets log properties', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensureAppLogs(ctx, 'myapp', { 'max-size': '10m' })
    expect(runner.run).toHaveBeenCalledWith('logs:set', 'myapp', 'max-size', '10m')
  })
})

describe('exportAppLogs', () => {
  it('returns undefined (simplified stub)', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('some logs output')
    const ctx = createContext(runner)
    const result = await exportAppLogs(ctx, 'myapp')
    expect(result).toBeUndefined()
  })
})
