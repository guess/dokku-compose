import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { ensureAppDomains, ensureGlobalDomains, exportAppDomains } from './domains.js'

describe('ensureAppDomains', () => {
  it('sets domains when list provided', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    await ensureAppDomains(runner, 'myapp', ['example.com', 'www.example.com'])
    expect(runner.run).toHaveBeenCalledWith('domains:enable', 'myapp')
    expect(runner.run).toHaveBeenCalledWith('domains:set', 'myapp', 'example.com', 'www.example.com')
  })

  it('disables and clears when domains: false', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    await ensureAppDomains(runner, 'myapp', false)
    expect(runner.run).toHaveBeenCalledWith('domains:disable', 'myapp')
    expect(runner.run).toHaveBeenCalledWith('domains:clear', 'myapp')
  })

  it('skips when config is undefined', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    await ensureAppDomains(runner, 'myapp', undefined)
    expect(runner.run).not.toHaveBeenCalled()
  })
})

describe('ensureGlobalDomains', () => {
  it('clears global domains when false', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    await ensureGlobalDomains(runner, false)
    expect(runner.run).toHaveBeenCalledWith('domains:clear-global')
  })

  it('sets global domains when list provided', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    await ensureGlobalDomains(runner, ['example.com', 'www.example.com'])
    expect(runner.run).toHaveBeenCalledWith('domains:set-global', 'example.com', 'www.example.com')
  })
})

describe('exportAppDomains', () => {
  it('returns domain list when domains enabled', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn()
      .mockResolvedValueOnce('true')  // domains-app-enabled
      .mockResolvedValueOnce('example.com\nwww.example.com')  // domains-app-vhosts
    const result = await exportAppDomains(runner, 'myapp')
    expect(result).toEqual(['example.com', 'www.example.com'])
  })

  it('returns false when domains disabled', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValueOnce('false')  // domains-app-enabled
    const result = await exportAppDomains(runner, 'myapp')
    expect(result).toBe(false)
  })

  it('returns undefined when no vhosts configured', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn()
      .mockResolvedValueOnce('true')  // domains-app-enabled
      .mockResolvedValueOnce('')      // no vhosts
    const result = await exportAppDomains(runner, 'myapp')
    expect(result).toBeUndefined()
  })
})
