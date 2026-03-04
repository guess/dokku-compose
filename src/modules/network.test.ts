import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { ensureNetworks, ensureAppNetworks, exportNetworks, exportAppNetwork } from './network.js'

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
  it('returns user-defined networks, filtering header and built-ins', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue(
      '=====> Networks\nbridge\nhost\nnone\napp-net\nstudio-net'
    )
    const result = await exportNetworks(runner)
    expect(result).toEqual(['app-net', 'studio-net'])
  })
})

describe('exportAppNetwork', () => {
  it('returns networks from attach-post-deploy field', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue(
      'Network attach post deploy: app-net studio-net\nNetwork attach post create: \n'
    )
    const result = await exportAppNetwork(runner, 'myapp')
    expect(result).toEqual({ networks: ['app-net', 'studio-net'] })
  })

  it('returns undefined when no network info', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
    const result = await exportAppNetwork(runner, 'myapp')
    expect(result).toBeUndefined()
  })
})
