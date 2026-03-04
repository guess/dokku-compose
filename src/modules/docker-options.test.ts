import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { ensureAppDockerOptions } from './docker-options.js'

describe('ensureAppDockerOptions', () => {
  it('clears phase before adding options', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    await ensureAppDockerOptions(runner, 'myapp', {
      deploy: ['--restart=always']
    })
    const calls = (runner.run as any).mock.calls.map((c: string[]) => c.join(' '))
    const clearIdx = calls.findIndex((c: string) => c.includes('docker-options:clear'))
    const addIdx = calls.findIndex((c: string) => c.includes('docker-options:add'))
    expect(clearIdx).toBeGreaterThanOrEqual(0)
    expect(addIdx).toBeGreaterThanOrEqual(0)
    expect(clearIdx).toBeLessThan(addIdx)
  })

  it('adds docker options for phase', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    await ensureAppDockerOptions(runner, 'myapp', {
      deploy: ['--restart=always', '--memory=512m']
    })
    expect(runner.run).toHaveBeenCalledWith('docker-options:add', 'myapp', 'deploy', '--restart=always')
    expect(runner.run).toHaveBeenCalledWith('docker-options:add', 'myapp', 'deploy', '--memory=512m')
  })

  it('skips phases with no options', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    await ensureAppDockerOptions(runner, 'myapp', { deploy: ['--restart=always'] })
    const calls = (runner.run as any).mock.calls.map((c: string[]) => c.join(' '))
    // Should not clear build or run phases
    expect(calls.filter((c: string) => c.includes('build')).length).toBe(0)
    expect(calls.filter((c: string) => c.includes('docker-options:clear myapp run')).length).toBe(0)
  })
})
