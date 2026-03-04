import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { ensureServices, ensureAppLinks } from './services.js'

describe('ensureServices', () => {
  it('creates service that does not exist', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)  // postgres:exists returns false
    runner.run = vi.fn()
    const services = { 'api-postgres': { plugin: 'postgres' } }
    await ensureServices(runner, services)
    expect(runner.run).toHaveBeenCalledWith('postgres:create', 'api-postgres')
  })

  it('skips service that exists', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)
    runner.run = vi.fn()
    await ensureServices(runner, { 'api-postgres': { plugin: 'postgres' } })
    expect(runner.run).not.toHaveBeenCalled()
  })
})

describe('ensureAppLinks', () => {
  it('links desired services not yet linked', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)  // nothing linked yet
    runner.run = vi.fn()
    const services = { 'api-postgres': { plugin: 'postgres' } }
    await ensureAppLinks(runner, 'myapp', ['api-postgres'], services)
    expect(runner.run).toHaveBeenCalledWith('postgres:link', 'api-postgres', 'myapp', '--no-restart')
  })

  it('skips service already linked', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)  // already linked
    runner.run = vi.fn()
    const services = { 'api-postgres': { plugin: 'postgres' } }
    await ensureAppLinks(runner, 'myapp', ['api-postgres'], services)
    expect(runner.run).not.toHaveBeenCalled()
  })

  it('unlinks services linked but not in desired list', async () => {
    const runner = createRunner({ dryRun: false })
    // api-postgres is linked but NOT in desired links
    runner.check = vi.fn().mockImplementation(async (...args: string[]) =>
      args[0] === 'postgres:linked' ? true : false
    )
    runner.run = vi.fn()
    const allServices = { 'api-postgres': { plugin: 'postgres' } }
    await ensureAppLinks(runner, 'myapp', [], allServices)
    expect(runner.run).toHaveBeenCalledWith('postgres:unlink', 'api-postgres', 'myapp', '--no-restart')
  })
})
