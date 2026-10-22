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
    runner.query = vi.fn().mockResolvedValue(JSON.stringify([
      { name: 'postgres', version: '1.46.2' }, { name: 'redis', version: '1.42.2' },
    ]))
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
  const list = (v: string, committish = '') => JSON.stringify([{ name: 'postgres', version: v, enabled: true, core: false, committish }])

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
    const out = JSON.stringify([
      { name: 'a', version: '1.0.0' }, { name: 'b', version: '2.0.0' },
      { name: 'c', version: '1.0.0', committish: 'aaaaaaaa' }, { name: 'd', version: '1.0.0' },
    ])
    const plans = planPlugins(out, {
      a: { url, version: '1.2.0' }, b: { url, version: '1.0.0' }, c: { url, version: 'bbbbbbb' },
      d: { url }, e: { url, version: '1.0.0' },
    })
    expect(plans.map(p => [p.name, p.action])).toEqual([
      ['a', 'update'], ['b', 'newer'], ['c', 'unknown'], ['d', 'ok'], ['e', 'install'],
    ])
  })

  it('treats a core plugin and a version-less entry as installed', () => {
    const out = JSON.stringify([
      { name: 'core1', version: '0.38.31', core: true, source_url: '', committish: '' },
      { name: 'nover', version: '', committish: '' },
    ])
    const plans = planPlugins(out, { core1: { url }, nover: { url } })
    expect(plans.map(p => p.action)).toEqual(['ok', 'ok'])
  })

  it('compares a sha pin with the installed commit prefix', () => {
    const sha = '9b549f8' + '0'.repeat(33)
    const out = JSON.stringify([{ name: 'a', version: '2.4.0', committish: sha }])
    expect(planPlugins(out, { a: { url, version: '9b549f8' } })[0].action).toBe('ok')
    expect(planPlugins(out, { a: { url, version: '1234567' } })[0].action).toBe('unknown')
  })

  it('never equates 1.2 with 1.2.0', () => {
    const out = JSON.stringify([{ name: 'a', version: '1.2.0' }])
    expect(planPlugins(out, { a: { url, version: '1.2' } })[0].action).toBe('unknown')
  })
})
