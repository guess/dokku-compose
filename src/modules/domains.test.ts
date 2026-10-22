import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { ensureAppDomains, ensureGlobalDomains, exportAppDomains } from './domains.js'

describe('ensureAppDomains', () => {
  it('sets domains when list provided', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensureAppDomains(ctx, 'myapp', ['example.com', 'www.example.com'])
    expect(runner.run).toHaveBeenCalledWith('domains:enable', 'myapp')
    expect(runner.run).toHaveBeenCalledWith('domains:set', 'myapp', 'example.com', 'www.example.com')
  })

  it('disables and clears when domains: false', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensureAppDomains(ctx, 'myapp', false)
    expect(runner.run).toHaveBeenCalledWith('domains:disable', 'myapp')
    expect(runner.run).toHaveBeenCalledWith('domains:clear', 'myapp')
  })

  it('skips when config is undefined', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensureAppDomains(ctx, 'myapp', undefined)
    expect(runner.run).not.toHaveBeenCalled()
  })
})

describe('ensureGlobalDomains', () => {
  function setup(vhosts: string | Error) {
    const runner = createRunner({ dryRun: false })
    runner.queryStrict = vi.fn(async (...args: string[]) => {
      if (args.join(' ') !== 'domains:report --global --domains-global-vhosts') throw new Error(`unexpected ${args.join(' ')}`)
      if (vhosts instanceof Error) throw vhosts
      return vhosts
    })
    runner.run = vi.fn()
    return createContext(runner)
  }

  it('the same domains in another order run nothing', async () => {
    const ctx = setup('www.example.com example.com')
    await ensureGlobalDomains(ctx, ['example.com', 'www.example.com'])
    expect(ctx.commands).toEqual([])
  })

  it('changed domains run domains:set-global with the declared list', async () => {
    const ctx = setup('old.example.com')
    await ensureGlobalDomains(ctx, ['example.com', 'www.example.com'])
    expect(ctx.commands).toEqual([['domains:set-global', 'example.com', 'www.example.com']])
  })

  it('no global domains on the server: domains:set-global', async () => {
    const ctx = setup('')
    await ensureGlobalDomains(ctx, ['example.com'])
    expect(ctx.commands).toEqual([['domains:set-global', 'example.com']])
  })

  it('domains: false clears only when the server has global domains', async () => {
    const set = setup('example.com')
    await ensureGlobalDomains(set, false)
    expect(set.commands).toEqual([['domains:clear-global']])
    const empty = setup('')
    await ensureGlobalDomains(empty, false)
    expect(empty.commands).toEqual([])
  })

  it('an unreadable report is an error, and nothing is set or cleared', async () => {
    for (const desired of [['example.com'], false] as const) {
      const ctx = setup(new Error('dokku domains:report failed (exit 1)'))
      await expect(ensureGlobalDomains(ctx, desired as string[] | false)).rejects.toThrow('domains:report failed')
      expect(ctx.commands).toEqual([])
    }
  })
})

describe('exportAppDomains', () => {
  it('returns domain list when domains enabled', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn()
      .mockResolvedValueOnce('true')  // domains-app-enabled
      .mockResolvedValueOnce('example.com\nwww.example.com')  // domains-app-vhosts
    const ctx = createContext(runner)
    const result = await exportAppDomains(ctx, 'myapp')
    expect(result).toEqual(['example.com', 'www.example.com'])
  })

  it('returns false when domains disabled', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValueOnce('false')  // domains-app-enabled
    const ctx = createContext(runner)
    const result = await exportAppDomains(ctx, 'myapp')
    expect(result).toBe(false)
  })

  it('returns undefined when no vhosts configured', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn()
      .mockResolvedValueOnce('true')  // domains-app-enabled
      .mockResolvedValueOnce('')      // no vhosts
    const ctx = createContext(runner)
    const result = await exportAppDomains(ctx, 'myapp')
    expect(result).toBeUndefined()
  })
})
