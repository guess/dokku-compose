import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { ensureAppNginx, exportAppNginx } from './nginx.js'

describe('ensureAppNginx', () => {
  it('sets nginx properties', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    await ensureAppNginx(runner, 'myapp', { 'client-max-body-size': '15m' })
    expect(runner.run).toHaveBeenCalledWith('nginx:set', 'myapp', 'client-max-body-size', '15m')
  })
})

describe('exportAppNginx', () => {
  it('returns undefined when no nginx output', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
    const result = await exportAppNginx(runner, 'myapp')
    expect(result).toBeUndefined()
  })

  it('returns only app-level properties with real values', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue([
      '       Nginx client max body size: 15m',
      '       Nginx computed client max body size: 15m',
      '       Nginx global client max body size: 1m',
      '       Nginx access log format:  ',
      '       Nginx computed access log format:  ',
      '       Nginx last visited at:  ',
    ].join('\n'))
    const result = await exportAppNginx(runner, 'myapp')
    expect(result).toEqual({ 'client-max-body-size': '15m' })
  })

  it('returns undefined when all app-level values are empty', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue([
      '       Nginx access log format:  ',
      '       Nginx computed access log format: default',
      '       Nginx global access log format: default',
    ].join('\n'))
    const result = await exportAppNginx(runner, 'myapp')
    expect(result).toBeUndefined()
  })
})
