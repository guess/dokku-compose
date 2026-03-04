import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { ensureAppNginx, exportAppNginx } from './nginx.js'

describe('ensureAppNginx', () => {
  it('sets nginx properties', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensureAppNginx(ctx, 'myapp', { 'client-max-body-size': '15m' })
    expect(runner.run).toHaveBeenCalledWith('nginx:set', 'myapp', 'client-max-body-size', '15m')
  })
})

describe('ensureAppNginx idempotency and proxy rebuild', () => {
  it('skips nginx:set when value already matches', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('       Nginx client max body size: 15m\n')
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensureAppNginx(ctx, 'myapp', { 'client-max-body-size': '15m' })
    expect(runner.run).not.toHaveBeenCalledWith('nginx:set', expect.anything(), expect.anything(), expect.anything())
    expect(runner.run).not.toHaveBeenCalledWith('proxy:build-config', expect.anything())
  })

  it('calls nginx:set and proxy:build-config when value differs', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('       Nginx client max body size: 1m\n')
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensureAppNginx(ctx, 'myapp', { 'client-max-body-size': '15m' })
    expect(runner.run).toHaveBeenCalledWith('nginx:set', 'myapp', 'client-max-body-size', '15m')
    expect(runner.run).toHaveBeenCalledWith('proxy:build-config', 'myapp')
  })

  it('calls nginx:set and proxy:build-config when property not yet set', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensureAppNginx(ctx, 'myapp', { 'client-max-body-size': '15m' })
    expect(runner.run).toHaveBeenCalledWith('nginx:set', 'myapp', 'client-max-body-size', '15m')
    expect(runner.run).toHaveBeenCalledWith('proxy:build-config', 'myapp')
  })

  it('does not call proxy:build-config when nothing changed', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('       Nginx client max body size: 15m\n')
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensureAppNginx(ctx, 'myapp', { 'client-max-body-size': '15m' })
    expect(runner.run).not.toHaveBeenCalled()
  })
})

describe('exportAppNginx', () => {
  it('returns undefined when no nginx output', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
    const ctx = createContext(runner)
    const result = await exportAppNginx(ctx, 'myapp')
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
    const ctx = createContext(runner)
    const result = await exportAppNginx(ctx, 'myapp')
    expect(result).toEqual({ 'client-max-body-size': '15m' })
  })

  it('returns undefined when all app-level values are empty', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue([
      '       Nginx access log format:  ',
      '       Nginx computed access log format: default',
      '       Nginx global access log format: default',
    ].join('\n'))
    const ctx = createContext(runner)
    const result = await exportAppNginx(ctx, 'myapp')
    expect(result).toBeUndefined()
  })
})
