import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { ensureAppPorts, exportAppPorts } from './ports.js'

describe('ensureAppPorts', () => {
  it('sets ports when not configured', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
    runner.run = vi.fn()
    await ensureAppPorts(runner, 'myapp', ['http:80:3000'])
    expect(runner.run).toHaveBeenCalledWith('ports:set', 'myapp', 'http:80:3000')
  })

  it('skips when ports already match (different order)', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('https:443:4000 http:80:3000')
    runner.run = vi.fn()
    await ensureAppPorts(runner, 'myapp', ['http:80:3000', 'https:443:4000'])
    expect(runner.run).not.toHaveBeenCalled()
  })

  it('updates when ports differ', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('http:80:4000')
    runner.run = vi.fn()
    await ensureAppPorts(runner, 'myapp', ['http:80:3000'])
    expect(runner.run).toHaveBeenCalledWith('ports:set', 'myapp', 'http:80:3000')
  })
})

describe('exportAppPorts', () => {
  it('returns list of port mappings', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('http:80:3000 https:443:4000')
    const result = await exportAppPorts(runner, 'myapp')
    expect(result).toEqual(['http:80:3000', 'https:443:4000'])
  })

  it('returns undefined when no ports configured', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
    const result = await exportAppPorts(runner, 'myapp')
    expect(result).toBeUndefined()
  })
})
