import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { ensureAppRegistry, exportAppRegistry } from './registry.js'

describe('ensureAppRegistry', () => {
  it('sets registry properties', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    await ensureAppRegistry(runner, 'myapp', { 'push-on-release': true, server: 'registry.example.com' })
    expect(runner.run).toHaveBeenCalledWith('registry:set', 'myapp', 'push-on-release', 'true')
    expect(runner.run).toHaveBeenCalledWith('registry:set', 'myapp', 'server', 'registry.example.com')
  })
})

describe('exportAppRegistry', () => {
  it('returns undefined (simplified stub)', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('some registry output')
    const result = await exportAppRegistry(runner, 'myapp')
    expect(result).toBeUndefined()
  })
})
