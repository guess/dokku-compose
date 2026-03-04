import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { runUp } from './up.js'
import { loadConfig } from '../core/config.js'
import path from 'path'

const FIXTURES = path.join(import.meta.dirname, '../tests/fixtures')

describe('runUp', () => {
  it('creates app and services from simple.yml', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)  // nothing exists
    runner.run = vi.fn()
    runner.query = vi.fn().mockResolvedValue('')
    const config = loadConfig(path.join(FIXTURES, 'simple.yml'))
    await runUp(runner, config, [])
    expect(runner.run).toHaveBeenCalledWith('apps:create', 'myapp')
    expect(runner.run).toHaveBeenCalledWith('postgres:create', 'myapp-postgres')
    expect(runner.run).toHaveBeenCalledWith('postgres:link', 'myapp-postgres', 'myapp', '--no-restart')
  })

  it('filters to specific apps when appFilter provided', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.run = vi.fn()
    runner.query = vi.fn().mockResolvedValue('')
    const config = loadConfig(path.join(FIXTURES, 'full.yml'))
    await runUp(runner, config, ['funqtion'])
    expect(runner.run).toHaveBeenCalledWith('apps:create', 'funqtion')
    expect(runner.run).not.toHaveBeenCalledWith('apps:create', 'studio')
  })
})
