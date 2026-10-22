import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { ensureAppLogs, ensureGlobalLogs, exportAppLogs } from './logs.js'

describe('ensureAppLogs', () => {
  it('sets log properties', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensureAppLogs(ctx, 'myapp', { 'max-size': '10m' })
    expect(runner.run).toHaveBeenCalledWith('logs:set', 'myapp', 'max-size', '10m')
  })
})

describe('exportAppLogs', () => {
  it('returns undefined (simplified stub)', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('some logs output')
    const ctx = createContext(runner)
    const result = await exportAppLogs(ctx, 'myapp')
    expect(result).toBeUndefined()
  })
})

describe('ensureGlobalLogs', () => {
  function setup(answer: string | Error) {
    const runner = createRunner({ dryRun: false })
    runner.queryStrict = vi.fn(async (...args: string[]) => {
      if (args.join(' ') !== 'logs:report --global --format json') throw new Error(`unexpected ${args.join(' ')}`)
      if (answer instanceof Error) throw answer
      return answer
    })
    runner.run = vi.fn()
    return createContext(runner)
  }

  it('values already set globally run nothing', async () => {
    const ctx = setup(JSON.stringify({ 'global-max-size': '50m', 'computed-max-size': '50m', 'global-vector-sink': 'console://?encoding[codec]=json' }))
    await ensureGlobalLogs(ctx, { 'max-size': '50m', 'vector-sink': 'console://?encoding[codec]=json' })
    expect(ctx.commands).toEqual([])
  })

  it('sets only the keys that differ or are missing', async () => {
    const ctx = setup(JSON.stringify({ 'global-max-size': 'other', 'vector-sink': 'console://?encoding[codec]=json', 'global-vector-sink': '' }))
    await ensureGlobalLogs(ctx, { 'max-size': '50m', 'vector-sink': 'console://?encoding[codec]=json' })
    expect(ctx.commands).toEqual([
      ['logs:set', '--global', 'max-size', '50m'],
      ['logs:set', '--global', 'vector-sink', 'console://?encoding[codec]=json'],
    ])
  })

  it('an unreadable report is an error, and nothing is set', async () => {
    for (const answer of [new Error('logs:report failed'), '']) {
      const ctx = setup(answer)
      await expect(ensureGlobalLogs(ctx, { 'max-size': '50m' })).rejects.toThrow()
      expect(ctx.commands).toEqual([])
    }
  })
})
