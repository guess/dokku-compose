import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { ensurePlugins } from './plugins.js'

describe('ensurePlugins', () => {
  it('installs plugin not yet installed', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensurePlugins(ctx, {
      postgres: { url: 'https://github.com/dokku/dokku-postgres.git' }
    })
    expect(runner.check).toHaveBeenCalledWith('plugin:installed', 'postgres')
    expect(runner.run).toHaveBeenCalledWith(
      'plugin:install', 'https://github.com/dokku/dokku-postgres.git', '--name', 'postgres'
    )
  })

  it('skips plugin already installed', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensurePlugins(ctx, {
      postgres: { url: 'https://github.com/dokku/dokku-postgres.git' }
    })
    expect(runner.check).toHaveBeenCalledWith('plugin:installed', 'postgres')
    expect(runner.run).not.toHaveBeenCalled()
  })
})
