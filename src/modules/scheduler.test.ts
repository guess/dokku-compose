import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { ensureAppScheduler } from './scheduler.js'

describe('ensureAppScheduler', () => {
  it('sets scheduler when different', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('docker-local')
    runner.run = vi.fn()
    await ensureAppScheduler(runner, 'myapp', 'kubernetes')
    expect(runner.run).toHaveBeenCalledWith('scheduler:set', 'myapp', 'selected', 'kubernetes')
  })

  it('skips when scheduler already matches', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('kubernetes')
    runner.run = vi.fn()
    await ensureAppScheduler(runner, 'myapp', 'kubernetes')
    expect(runner.run).not.toHaveBeenCalled()
  })
})
