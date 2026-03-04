import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { ensureNetworks, ensureAppNetworks, exportNetworks } from './network.js'

describe('ensureNetworks', () => {
  it('creates network that does not exist', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.run = vi.fn()
    await ensureNetworks(runner, ['app-net'])
    expect(runner.run).toHaveBeenCalledWith('network:create', 'app-net')
  })

  it('skips existing network', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)
    runner.run = vi.fn()
    await ensureNetworks(runner, ['app-net'])
    expect(runner.run).not.toHaveBeenCalled()
  })
})

describe('ensureAppNetworks', () => {
  it('sets attach-post-deploy', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    await ensureAppNetworks(runner, 'myapp', ['app-net'])
    expect(runner.run).toHaveBeenCalledWith('network:set', 'myapp', 'attach-post-deploy', 'app-net')
  })

  it('skips when networks undefined', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    await ensureAppNetworks(runner, 'myapp', undefined)
    expect(runner.run).not.toHaveBeenCalled()
  })
})

describe('exportNetworks', () => {
  it('returns list of networks', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('app-net\nstudio-net')
    const result = await exportNetworks(runner)
    expect(result).toEqual(['app-net', 'studio-net'])
  })
})
