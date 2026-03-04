import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { ensureAppStorage } from './storage.js'

describe('ensureAppStorage', () => {
  it('mounts new storage', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
    runner.run = vi.fn()
    await ensureAppStorage(runner, 'myapp', ['/host/path:/app/data'])
    expect(runner.run).toHaveBeenCalledWith('storage:mount', 'myapp', '/host/path:/app/data')
  })

  it('unmounts stale mounts', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('/old/path:/app/old')
    runner.run = vi.fn()
    await ensureAppStorage(runner, 'myapp', ['/new/path:/app/new'])
    expect(runner.run).toHaveBeenCalledWith('storage:unmount', 'myapp', '/old/path:/app/old')
    expect(runner.run).toHaveBeenCalledWith('storage:mount', 'myapp', '/new/path:/app/new')
  })

  it('skips when storage already matches', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('/host/path:/app/data')
    runner.run = vi.fn()
    await ensureAppStorage(runner, 'myapp', ['/host/path:/app/data'])
    expect(runner.run).not.toHaveBeenCalled()
  })
})
