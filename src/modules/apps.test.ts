import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { ensureApp, destroyApp, exportApps } from './apps.js'

describe('ensureApp', () => {
  it('creates app when it does not exist', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)  // apps:exists returns false
    runner.run = vi.fn()
    await ensureApp(runner, 'myapp')
    expect(runner.run).toHaveBeenCalledWith('apps:create', 'myapp')
  })

  it('skips when app already exists', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)  // apps:exists returns true
    runner.run = vi.fn()
    await ensureApp(runner, 'myapp')
    expect(runner.run).not.toHaveBeenCalled()
  })
})

describe('destroyApp', () => {
  it('destroys with force when app exists', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)
    runner.run = vi.fn()
    await destroyApp(runner, 'myapp')
    expect(runner.run).toHaveBeenCalledWith('apps:destroy', 'myapp', '--force')
  })

  it('skips when app does not exist', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.run = vi.fn()
    await destroyApp(runner, 'myapp')
    expect(runner.run).not.toHaveBeenCalled()
  })
})

describe('exportApps', () => {
  it('returns list of apps', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('myapp\notherapp')
    const result = await exportApps(runner)
    expect(result).toEqual(['myapp', 'otherapp'])
  })

  it('returns empty array when no apps', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
    const result = await exportApps(runner)
    expect(result).toEqual([])
  })
})
