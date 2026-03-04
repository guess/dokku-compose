import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { runDown } from './down.js'
import { loadConfig } from '../core/config.js'
import path from 'path'

const FIXTURES = path.join(import.meta.dirname, '../tests/fixtures')

describe('runDown', () => {
  it('destroys app from simple.yml', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)  // everything exists
    runner.query = vi.fn().mockResolvedValue('')    // no linked apps for service check
    runner.run = vi.fn()
    const config = loadConfig(path.join(FIXTURES, 'simple.yml'))
    await runDown(runner, config, [], { force: true })
    expect(runner.run).toHaveBeenCalledWith('apps:destroy', 'myapp', '--force')
  })

  it('destroys app before services (correct order)', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)
    runner.query = vi.fn().mockResolvedValue('')
    runner.run = vi.fn()
    const config = loadConfig(path.join(FIXTURES, 'simple.yml'))
    await runDown(runner, config, [], { force: true })
    const calls = (runner.run as any).mock.calls.map((c: string[]) => c.join(' '))
    const appDestroyIdx = calls.findIndex((c: string) => c.includes('apps:destroy'))
    const svcDestroyIdx = calls.findIndex((c: string) => c.includes('postgres:destroy'))
    expect(appDestroyIdx).toBeGreaterThanOrEqual(0)
    expect(svcDestroyIdx).toBeGreaterThanOrEqual(0)
    expect(appDestroyIdx).toBeLessThan(svcDestroyIdx)
  })
})
