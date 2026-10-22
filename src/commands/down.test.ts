import { describe, it, expect, vi } from 'vitest'
import { createRunner, DokkuCommandError } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { runDown, DownFailedError } from './down.js'
import { loadConfig } from '../core/config.js'
import path from 'path'

const FIXTURES = path.join(import.meta.dirname, '../tests/fixtures')

describe('runDown', () => {
  it('destroys app from simple.yml', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)  // everything exists
    runner.query = vi.fn(async (...args: string[]) => args[0] === 'version' ? 'dokku version 0.38.31' : '')    // no linked apps for service check
    runner.run = vi.fn()
    const ctx = createContext(runner)
    const config = loadConfig(path.join(FIXTURES, 'simple.yml'))
    await runDown(ctx, config, [], { force: true })
    expect(runner.run).toHaveBeenCalledWith('apps:destroy', 'myapp', '--force')
  })

  it('destroys app before services (correct order)', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)
    runner.query = vi.fn(async (...args: string[]) => args[0] === 'version' ? 'dokku version 0.38.31' : '')
    runner.run = vi.fn()
    const ctx = createContext(runner)
    const config = loadConfig(path.join(FIXTURES, 'simple.yml'))
    await runDown(ctx, config, [], { force: true })
    const calls = (runner.run as any).mock.calls.map((c: string[]) => c.join(' '))
    const appDestroyIdx = calls.findIndex((c: string) => c.includes('apps:destroy'))
    const svcDestroyIdx = calls.findIndex((c: string) => c.includes('postgres:destroy'))
    expect(appDestroyIdx).toBeGreaterThanOrEqual(0)
    expect(svcDestroyIdx).toBeGreaterThanOrEqual(0)
    expect(appDestroyIdx).toBeLessThan(svcDestroyIdx)
  })

  it('continues to the next app when one fails to destroy, then throws a summary', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)
    runner.query = vi.fn(async (...args: string[]) => args[0] === 'version' ? 'dokku version 0.38.31' : '')
    runner.run = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'apps:destroy' && args[1] === 'funqtion') {
        throw new DokkuCommandError(args, 1, 'app has a running deploy')
      }
    })
    const ctx = createContext(runner)
    const config = loadConfig(path.join(FIXTURES, 'full.yml'))

    let thrown: unknown
    try {
      await runDown(ctx, config, ['funqtion', 'studio'], { force: true })
    } catch (e) {
      thrown = e
    }

    expect(thrown).toBeInstanceOf(DownFailedError)
    expect((thrown as DownFailedError).failures.map(f => f.app)).toEqual(['funqtion'])
    expect(runner.run).toHaveBeenCalledWith('apps:destroy', 'studio', '--force')
    expect((thrown as DownFailedError).message).toContain('service and network teardown was skipped')
  })

  it('--fail-fast stops at the first failing app', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)
    runner.query = vi.fn(async (...args: string[]) => args[0] === 'version' ? 'dokku version 0.38.31' : '')
    runner.run = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'apps:destroy' && args[1] === 'funqtion') {
        throw new DokkuCommandError(args, 1, 'boom')
      }
    })
    const ctx = createContext(runner)
    const config = loadConfig(path.join(FIXTURES, 'full.yml'))

    await expect(
      runDown(ctx, config, ['funqtion', 'studio'], { force: true, failFast: true })
    ).rejects.toThrow(DokkuCommandError)
    expect(runner.run).not.toHaveBeenCalledWith('apps:destroy', 'studio', '--force')
  })
})
