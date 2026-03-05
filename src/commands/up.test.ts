import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { runUp } from './up.js'
import { loadConfig } from '../core/config.js'
import path from 'path'

const FIXTURES = path.join(import.meta.dirname, '../tests/fixtures')

describe('runUp', () => {
  it('creates app and services from simple.yml', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.run = vi.fn()
    runner.query = vi.fn().mockResolvedValue('')
    const ctx = createContext(runner)
    const config = loadConfig(path.join(FIXTURES, 'simple.yml'))
    await runUp(ctx, config, [])
    expect(runner.run).toHaveBeenCalledWith('apps:create', 'myapp')
    expect(runner.run).toHaveBeenCalledWith('postgres:create', 'myapp-postgres')
    expect(runner.run).toHaveBeenCalledWith('postgres:link', 'myapp-postgres', 'myapp', '--no-restart')
  })

  it('dry-run skips commands for resources already in sync', async () => {
    const runner = createRunner({ dryRun: true })
    // Simulate server where app and network already exist
    runner.check = vi.fn().mockImplementation(async (...args: string[]) => {
      const cmd = args.join(' ')
      if (cmd === 'apps:exists myapp') return true
      if (cmd === 'network:exists app-net') return true
      if (cmd === 'postgres:exists myapp-postgres') return true
      return false
    })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      const cmd = args.join(' ')
      // App already has the right ports
      if (cmd === 'ports:report myapp --ports-map') return 'http:5000:5000'
      // Plugin already installed
      if (cmd === 'plugin:list') return 'postgres'
      // Service already linked
      if (cmd === 'postgres:info myapp-postgres --links') return 'myapp'
      return ''
    })
    runner.run = vi.fn()
    const ctx = createContext(runner)
    const config = loadConfig(path.join(FIXTURES, 'simple.yml'))
    await runUp(ctx, config, [])

    // Since everything is in sync, no mutation commands should be recorded
    const runCalls = runner.run.mock.calls.map((c: string[]) => c.join(' '))
    expect(runCalls).not.toContainEqual(expect.stringContaining('apps:create'))
    expect(runCalls).not.toContainEqual(expect.stringContaining('network:create'))
  })

  it('filters to specific apps when appFilter provided', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.run = vi.fn()
    runner.query = vi.fn().mockResolvedValue('')
    const ctx = createContext(runner)
    const config = loadConfig(path.join(FIXTURES, 'full.yml'))
    await runUp(ctx, config, ['funqtion'])
    expect(runner.run).toHaveBeenCalledWith('apps:create', 'funqtion')
    expect(runner.run).not.toHaveBeenCalledWith('apps:create', 'studio')
  })
})
