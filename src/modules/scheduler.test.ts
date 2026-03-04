import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { ensureAppScheduler, exportAppScheduler } from './scheduler.js'

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

describe('exportAppScheduler', () => {
  it('returns scheduler when non-default', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('kubernetes')
    const result = await exportAppScheduler(runner, 'myapp')
    expect(result).toBe('kubernetes')
  })

  it('returns undefined for default docker-local scheduler', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('docker-local')
    const result = await exportAppScheduler(runner, 'myapp')
    expect(result).toBeUndefined()
  })

  it('returns undefined when empty response', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
    const result = await exportAppScheduler(runner, 'myapp')
    expect(result).toBeUndefined()
  })
})
