// src/core/reconcile.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createRunner } from './dokku.js'
import { createContext } from './context.js'
import { reconcile } from './reconcile.js'
import type { Resource } from './reconcile.js'

describe('reconcile', () => {
  function makeCtx() {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
    runner.run = vi.fn()
    runner.check = vi.fn().mockResolvedValue(false)
    return createContext(runner)
  }

  it('calls onChange when state differs', async () => {
    const ctx = makeCtx()
    const onChange = vi.fn()
    const resource: Resource<string> = {
      key: 'scheduler',
      read: async () => 'docker-local',
      onChange,
    }

    await reconcile(resource, ctx, 'myapp', 'k3s')

    expect(onChange).toHaveBeenCalledTimes(1)
    const change = onChange.mock.calls[0][2]
    expect(change.before).toBe('docker-local')
    expect(change.after).toBe('k3s')
    expect(change.changed).toBe(true)
  })

  it('skips onChange when state matches', async () => {
    const ctx = makeCtx()
    const onChange = vi.fn()
    const resource: Resource<string> = {
      key: 'scheduler',
      read: async () => 'docker-local',
      onChange,
    }

    await reconcile(resource, ctx, 'myapp', 'docker-local')

    expect(onChange).not.toHaveBeenCalled()
  })

  it('skips entirely when desired is undefined', async () => {
    const ctx = makeCtx()
    const read = vi.fn()
    const resource: Resource<string> = {
      key: 'scheduler',
      read,
      onChange: vi.fn(),
    }

    await reconcile(resource, ctx, 'myapp', undefined)

    expect(read).not.toHaveBeenCalled()
  })

  it('passes list change with added/removed for arrays', async () => {
    const ctx = makeCtx()
    const onChange = vi.fn()
    const resource: Resource<string[]> = {
      key: 'ports',
      read: async () => ['http:80:3000'],
      onChange,
    }

    await reconcile(resource, ctx, 'myapp', ['http:80:3000', 'https:443:3000'])

    const change = onChange.mock.calls[0][2]
    expect(change.added).toEqual(['https:443:3000'])
    expect(change.removed).toEqual([])
  })

  it('passes map change with added/removed/modified for objects', async () => {
    const ctx = makeCtx()
    const onChange = vi.fn()
    const resource: Resource<Record<string, string>> = {
      key: 'nginx',
      read: async () => ({ 'client-max-body-size': '1m', 'old-prop': 'x' }),
      onChange,
    }

    await reconcile(resource, ctx, 'myapp', {
      'client-max-body-size': '50m',
      'new-prop': 'y',
    })

    const change = onChange.mock.calls[0][2]
    expect(change.modified).toEqual({ 'client-max-body-size': '50m' })
    expect(change.added).toEqual({ 'new-prop': 'y' })
    expect(change.removed).toEqual(['old-prop'])
  })

  it('always calls onChange when forceApply is true', async () => {
    const ctx = makeCtx()
    const onChange = vi.fn()
    const read = vi.fn()
    const resource: Resource<{ build: string[] }> = {
      key: 'docker_options',
      forceApply: true,
      read,
      onChange,
    }

    await reconcile(resource, ctx, 'myapp', { build: ['--shm-size=256m'] })

    expect(read).not.toHaveBeenCalled()  // read is skipped
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][2].after).toEqual({ build: ['--shm-size=256m'] })
  })

  it('logs action and result via logger', async () => {
    const ctx = makeCtx()
    const resource: Resource<string> = {
      key: 'scheduler',
      read: async () => 'docker-local',
      onChange: vi.fn(),
    }

    // Just verifying no throws — logging is a side effect
    await reconcile(resource, ctx, 'myapp', 'k3s')
    await reconcile(resource, ctx, 'myapp', 'docker-local')
  })
})
