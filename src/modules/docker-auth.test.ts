import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { ensureDockerAuth } from './docker-auth.js'

describe('ensureDockerAuth', () => {
  it('logs in to each configured registry', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensureDockerAuth(ctx, {
      'ghcr.io': { username: 'octocat', password: 'ghp_secret' },
      'registry.example.com': { username: 'svc', password: 'pw' },
    })
    expect(runner.run).toHaveBeenCalledWith(
      'registry:login', 'ghcr.io', 'octocat', 'ghp_secret'
    )
    expect(runner.run).toHaveBeenCalledWith(
      'registry:login', 'registry.example.com', 'svc', 'pw'
    )
    expect(runner.run).toHaveBeenCalledTimes(2)
  })

  it('does nothing for an empty config', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensureDockerAuth(ctx, {})
    expect(runner.run).not.toHaveBeenCalled()
  })
})
