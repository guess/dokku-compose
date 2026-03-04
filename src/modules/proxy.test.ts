import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { ensureAppProxy } from './proxy.js'

describe('ensureAppProxy', () => {
  it('enables proxy when disabled', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('false')
    runner.run = vi.fn()
    await ensureAppProxy(runner, 'myapp', true)
    expect(runner.run).toHaveBeenCalledWith('proxy:enable', 'myapp')
  })

  it('disables proxy when enabled', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('true')
    runner.run = vi.fn()
    await ensureAppProxy(runner, 'myapp', false)
    expect(runner.run).toHaveBeenCalledWith('proxy:disable', 'myapp')
  })

  it('skips when already in desired state', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('true')
    runner.run = vi.fn()
    await ensureAppProxy(runner, 'myapp', true)
    expect(runner.run).not.toHaveBeenCalled()
  })
})
