import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { compareSemver, ensureDokkuVersion } from './version.js'

describe('compareSemver', () => {
  it('returns 0 for equal versions', () => {
    expect(compareSemver('0.37.9', '0.37.9')).toBe(0)
  })

  it('returns -1 when a is older (patch)', () => {
    expect(compareSemver('0.37.9', '0.37.10')).toBe(-1)
  })

  it('returns 1 when a is newer (minor)', () => {
    expect(compareSemver('0.38.0', '0.37.99')).toBe(1)
  })

  it('returns 1 when a is newer (major)', () => {
    expect(compareSemver('1.0.0', '0.99.99')).toBe(1)
  })

  it('ignores pre-release suffix when otherwise equal', () => {
    expect(compareSemver('0.37.9-rc1', '0.37.9')).toBe(0)
  })

  it('ignores pre-release suffix on both sides', () => {
    expect(compareSemver('0.37.9-rc1', '0.37.9-rc2')).toBe(0)
  })

  it('throws when input is not parseable', () => {
    expect(() => compareSemver('garbage', '0.37.9')).toThrow(/parse/i)
  })

  it('throws when only major.minor (missing patch)', () => {
    expect(() => compareSemver('0.37', '0.37.9')).toThrow(/parse/i)
  })
})

describe('ensureDokkuVersion', () => {
  it('does nothing when pinned is undefined (no query)', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn()
    const ctx = createContext(runner)
    await ensureDokkuVersion(ctx, undefined)
    expect(runner.query).not.toHaveBeenCalled()
  })

  it('is silent when server version equals pinned', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('dokku version 0.37.9')
    const ctx = createContext(runner)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await ensureDokkuVersion(ctx, '0.37.9')
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('is silent when server version is newer than pinned', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('0.38.0')
    const ctx = createContext(runner)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await ensureDokkuVersion(ctx, '0.37.9')
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('warns when server version is older than pinned', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('dokku version 0.36.4')
    const ctx = createContext(runner)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await ensureDokkuVersion(ctx, '0.37.9')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const msg = warnSpy.mock.calls[0][0] as string
    expect(msg).toContain('0.36.4')
    expect(msg).toContain('0.37.9')
    warnSpy.mockRestore()
  })

  it('throws when server output is unparseable', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('something weird')
    const ctx = createContext(runner)
    await expect(ensureDokkuVersion(ctx, '0.37.9')).rejects.toThrow(/parse/i)
  })
})
