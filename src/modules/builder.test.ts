import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { ensureAppBuilder } from './builder.js'

describe('ensureAppBuilder', () => {
  it('sets dockerfile path', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    await ensureAppBuilder(runner, 'myapp', { dockerfile: 'docker/Dockerfile.prod' })
    expect(runner.run).toHaveBeenCalledWith(
      'builder-dockerfile:set', 'myapp', 'dockerfile-path', 'docker/Dockerfile.prod'
    )
  })

  it('sets build context', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    await ensureAppBuilder(runner, 'myapp', { context: 'apps/myapp' })
    expect(runner.run).toHaveBeenCalledWith('builder:set', 'myapp', 'build-dir', 'apps/myapp')
  })

  it('sets build args', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    await ensureAppBuilder(runner, 'myapp', { args: { NODE_ENV: 'production' } })
    expect(runner.run).toHaveBeenCalledWith(
      'docker-options:add', 'myapp', 'build', '--build-arg NODE_ENV=production'
    )
  })

  it('does nothing when build is empty object', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    await ensureAppBuilder(runner, 'myapp', {})
    expect(runner.run).not.toHaveBeenCalled()
  })
})
