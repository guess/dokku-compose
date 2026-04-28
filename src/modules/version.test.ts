import { describe, it, expect } from 'vitest'
import { compareSemver } from './version.js'

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
