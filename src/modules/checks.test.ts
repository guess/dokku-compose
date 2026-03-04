import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { ensureAppChecks, exportAppChecks } from './checks.js'

describe('ensureAppChecks', () => {
  it('disables all checks when checks: false', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    await ensureAppChecks(runner, 'myapp', false)
    expect(runner.run).toHaveBeenCalledWith('checks:disable', 'myapp')
  })

  it('sets check properties', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    await ensureAppChecks(runner, 'myapp', { 'wait-to-retire': 60, attempts: 5 })
    expect(runner.run).toHaveBeenCalledWith('checks:set', 'myapp', 'wait-to-retire', '60')
    expect(runner.run).toHaveBeenCalledWith('checks:set', 'myapp', 'attempts', '5')
  })
})

describe('exportAppChecks', () => {
  it('returns undefined (simplified stub)', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('some checks output')
    const result = await exportAppChecks(runner, 'myapp')
    expect(result).toBeUndefined()
  })
})
