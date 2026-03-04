import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { ensureAppNginx } from './nginx.js'

describe('ensureAppNginx', () => {
  it('sets nginx properties', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    await ensureAppNginx(runner, 'myapp', { 'client-max-body-size': '15m' })
    expect(runner.run).toHaveBeenCalledWith('nginx:set', 'myapp', 'client-max-body-size', '15m')
  })
})
