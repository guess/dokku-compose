import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { ensureAppNginx, exportAppNginx } from './nginx.js'

describe('ensureAppNginx', () => {
  it('sets nginx properties', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    await ensureAppNginx(runner, 'myapp', { 'client-max-body-size': '15m' })
    expect(runner.run).toHaveBeenCalledWith('nginx:set', 'myapp', 'client-max-body-size', '15m')
  })
})

describe('exportAppNginx', () => {
  it('returns undefined when no nginx output', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
    const result = await exportAppNginx(runner, 'myapp')
    expect(result).toBeUndefined()
  })

  it('returns parsed nginx properties', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue(
      '       Nginx client max body size: 15m\n       Nginx proxy read timeout: 60s'
    )
    const result = await exportAppNginx(runner, 'myapp')
    expect(result).toBeDefined()
    expect(result).toHaveProperty('client-max-body-size', '15m')
  })
})
