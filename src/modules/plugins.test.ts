import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { ensurePlugins, planPlugins } from './plugins.js'

describe('ensurePlugins', () => {
  it('installs plugin not yet installed', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
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
    runner.query = vi.fn().mockResolvedValue(
      '  postgres             1.46.2 enabled    dokku postgres service plugin\n' +
      '  redis                1.42.2 enabled    dokku redis service plugin'
    )
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensurePlugins(ctx, {
      postgres: { url: 'https://github.com/dokku/dokku-postgres.git' }
    })
    expect(runner.run).not.toHaveBeenCalled()
  })
})

describe('ensurePlugins version pins', () => {
  const url = 'https://github.com/dokku/dokku-postgres.git'
  const list = (v: string) => `  postgres             ${v} enabled    dokku postgres service plugin\n`

  function setup(listOut: string) {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue(listOut)
    runner.run = vi.fn()
    return { ctx: createContext(runner), runner }
  }

  it('installs a missing plugin at its version with --committish', async () => {
    const { ctx, runner } = setup('')
    await ensurePlugins(ctx, { postgres: { url, version: '1.41.0' } })
    expect(runner.run).toHaveBeenCalledWith('plugin:install', url, '--committish', '1.41.0', '--name', 'postgres')
  })

  it('updates an older plugin, ignoring a leading v', async () => {
    const { ctx, runner } = setup(list('1.9.0'))
    await ensurePlugins(ctx, { postgres: { url, version: 'v1.41.0' } })
    expect(runner.run).toHaveBeenCalledWith('plugin:update', 'postgres', 'v1.41.0')
  })

  it('compares numerically, not as strings (1.9.0 < 1.41.0, 1.41.0 > 1.9.0)', async () => {
    const { ctx, runner } = setup(list('1.41.0'))
    await ensurePlugins(ctx, { postgres: { url, version: '1.9.0' } })
    expect(runner.run).not.toHaveBeenCalled()
  })

  it('does nothing when the version matches', async () => {
    const { ctx, runner } = setup(list('1.41.0'))
    await ensurePlugins(ctx, { postgres: { url, version: 'v1.41.0' } })
    expect(runner.run).not.toHaveBeenCalled()
  })

  it('warns and leaves a newer plugin', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { ctx, runner } = setup(list('2.4.0'))
    await ensurePlugins(ctx, { postgres: { url, version: '1.46.2' } })
    expect(runner.run).not.toHaveBeenCalled()
    expect([warn, err, log].flatMap(s => s.mock.calls).join('\n')).toContain('newer')
    vi.restoreAllMocks()
  })

  it('never updates when versions cannot be compared', async () => {
    const { ctx, runner } = setup(list('1.41.0'))
    await ensurePlugins(ctx, { postgres: { url, version: 'a1b2c3d' } })
    expect(runner.run).not.toHaveBeenCalled()
  })
})

describe('planPlugins', () => {
  const url = 'https://example.com/p.git'
  it('classifies each case', () => {
    const out = 'a 1.0.0 enabled x\nb 2.0.0 disabled y\nc deadbeef enabled z\nd 1.0.0 enabled w\n'
    const plans = planPlugins(out, {
      a: { url, version: '1.2.0' }, b: { url, version: '1.0.0' }, c: { url, version: '1.0.0' },
      d: { url }, e: { url, version: '1.0.0' },
    })
    expect(plans.map(p => [p.name, p.action])).toEqual([
      ['a', 'update'], ['b', 'newer'], ['c', 'unknown'], ['d', 'ok'], ['e', 'install'],
    ])
  })
})
