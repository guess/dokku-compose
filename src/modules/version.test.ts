import { describe, it, expect, vi } from 'vitest'
import { compareSemver, assertDokkuSupported, enforceFileVersion, MIN_DOKKU_VERSION } from './version.js'

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

function fakeCtx(version: string) {
  return { query: vi.fn(async () => version) }
}

describe('MIN_DOKKU_VERSION', () => {
  it('is the first Dokku with --format json on plugin:list', () => {
    expect(MIN_DOKKU_VERSION).toBe('0.38.22')
  })
})

describe('assertDokkuSupported', () => {
  it('returns the server version at the floor', async () => {
    expect(await assertDokkuSupported(fakeCtx('dokku version 0.38.22'))).toBe('0.38.22')
  })

  it('returns the server version above the floor', async () => {
    expect(await assertDokkuSupported(fakeCtx('0.38.31'))).toBe('0.38.31')
  })

  it('stops below the floor with the upgrade message', async () => {
    await expect(assertDokkuSupported(fakeCtx('dokku version 0.37.9'))).rejects.toThrow(
      /^dokku-compose \d+\.\d+\.\d+ needs Dokku >= 0\.38\.22; this server runs 0\.37\.9\. Upgrade Dokku first\.$/
    )
  })

  it('stops one patch below the floor', async () => {
    await expect(assertDokkuSupported(fakeCtx('0.38.21'))).rejects.toThrow(/this server runs 0\.38\.21/)
  })

  it('throws when server output is unparseable', async () => {
    await expect(assertDokkuSupported(fakeCtx('something weird'))).rejects.toThrow(/parse/i)
  })

  it('asks only for the version', async () => {
    const ctx = fakeCtx('0.38.31')
    await assertDokkuSupported(ctx)
    expect(ctx.query.mock.calls).toEqual([['version']])
  })
})

describe('enforceFileVersion', () => {
  it('does nothing when the file has no version', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => enforceFileVersion('0.38.31', undefined)).not.toThrow()
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('is silent when equal', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    enforceFileVersion('0.38.31', '0.38.31')
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('throws when the server is older than the file', () => {
    expect(() => enforceFileVersion('0.38.25', '0.38.31')).toThrow(/server is v0\.38\.25 but the file requires >= v0\.38\.31/)
  })

  it('logs one notice and does not throw when the server is newer', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => enforceFileVersion('0.38.32', '0.38.31')).not.toThrow()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const msg = warnSpy.mock.calls[0][0] as string
    expect(msg).toContain('0.38.32')
    expect(msg).toContain('0.38.31')
    warnSpy.mockRestore()
  })
})
