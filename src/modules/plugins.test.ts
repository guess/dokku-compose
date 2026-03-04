import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { ensurePlugins } from './plugins.js'

describe('ensurePlugins', () => {
  it('installs plugin not yet installed', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')  // no plugins installed
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensurePlugins(ctx, {
      postgres: { url: 'https://github.com/dokku/dokku-postgres.git' }
    })
    expect(runner.run).toHaveBeenCalledWith(
      'plugin:install', 'https://github.com/dokku/dokku-postgres.git', '--name', 'postgres'
    )
  })

  it('skips plugin already installed', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('postgres  1.0.0  enabled')
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensurePlugins(ctx, {
      postgres: { url: 'https://github.com/dokku/dokku-postgres.git' }
    })
    expect(runner.run).not.toHaveBeenCalled()
  })
})
