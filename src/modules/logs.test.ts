import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { ensureAppLogs } from './logs.js'

describe('ensureAppLogs', () => {
  it('sets log properties', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    await ensureAppLogs(runner, 'myapp', { 'max-size': '10m' })
    expect(runner.run).toHaveBeenCalledWith('logs:set', 'myapp', 'max-size', '10m')
  })
})
