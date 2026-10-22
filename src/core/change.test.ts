// src/core/change.test.ts
import { describe, it, expect } from 'vitest'
import { computeChange, computeAdditiveChange } from './change.js'

describe('computeChange — scalars', () => {
  it('detects no change for equal strings', () => {
    const c = computeChange('docker-local', 'docker-local')
    expect(c.changed).toBe(false)
  })

  it('detects change for different strings', () => {
    const c = computeChange('docker-local', 'k3s')
    expect(c.changed).toBe(true)
    expect(c.before).toBe('docker-local')
    expect(c.after).toBe('k3s')
  })

  it('detects change for booleans', () => {
    const c = computeChange(true, false)
    expect(c.changed).toBe(true)
  })

  it('detects no change for equal booleans', () => {
    const c = computeChange(false, false)
    expect(c.changed).toBe(false)
  })
})

describe('computeChange — arrays (ListChange)', () => {
  it('detects no change for same items in different order', () => {
    const c = computeChange(['b', 'a'], ['a', 'b'])
    expect(c.changed).toBe(false)
  })

  it('computes added items', () => {
    const c = computeChange(['a'], ['a', 'b', 'c'])
    expect(c.changed).toBe(true)
    expect(c.added).toEqual(['b', 'c'])
    expect(c.removed).toEqual([])
  })

  it('computes removed items', () => {
    const c = computeChange(['a', 'b', 'c'], ['a'])
    expect(c.changed).toBe(true)
    expect(c.added).toEqual([])
    expect(c.removed).toEqual(['b', 'c'])
  })

  it('computes both added and removed', () => {
    const c = computeChange(['a', 'b'], ['b', 'c'])
    expect(c.changed).toBe(true)
    expect(c.added).toEqual(['c'])
    expect(c.removed).toEqual(['a'])
  })

  it('handles empty before (all added)', () => {
    const c = computeChange([], ['a', 'b'])
    expect(c.changed).toBe(true)
    expect(c.added).toEqual(['a', 'b'])
    expect(c.removed).toEqual([])
  })
})

describe('computeChange — objects (MapChange)', () => {
  it('detects no change for equal maps', () => {
    const c = computeChange({ a: '1', b: '2' }, { a: '1', b: '2' })
    expect(c.changed).toBe(false)
  })

  it('computes added keys', () => {
    const c = computeChange({ a: '1' }, { a: '1', b: '2' })
    expect(c.changed).toBe(true)
    expect(c.added).toEqual({ b: '2' })
    expect(c.removed).toEqual([])
    expect(c.modified).toEqual({})
  })

  it('computes removed keys', () => {
    const c = computeChange({ a: '1', b: '2' }, { a: '1' })
    expect(c.changed).toBe(true)
    expect(c.added).toEqual({})
    expect(c.removed).toEqual(['b'])
    expect(c.modified).toEqual({})
  })

  it('computes modified keys', () => {
    const c = computeChange({ a: '1' }, { a: '2' })
    expect(c.changed).toBe(true)
    expect(c.added).toEqual({})
    expect(c.removed).toEqual([])
    expect(c.modified).toEqual({ a: '2' })
  })

  it('computes all three at once', () => {
    const c = computeChange(
      { keep: 'same', change: 'old', drop: 'bye' },
      { keep: 'same', change: 'new', add: 'hello' }
    )
    expect(c.changed).toBe(true)
    expect(c.added).toEqual({ add: 'hello' })
    expect(c.removed).toEqual(['drop'])
    expect(c.modified).toEqual({ change: 'new' })
  })

  it('handles empty before (all added)', () => {
    const c = computeChange({}, { a: '1', b: '2' })
    expect(c.changed).toBe(true)
    expect(c.added).toEqual({ a: '1', b: '2' })
  })
})

describe('computeChange — null/undefined (existence)', () => {
  it('detects creation (before null, after truthy)', () => {
    const c = computeChange(null, { certfile: 'a', keyfile: 'b' })
    expect(c.changed).toBe(true)
    expect(c.before).toBeNull()
  })

  it('detects destruction (before truthy, after null)', () => {
    const c = computeChange(true, null)
    expect(c.changed).toBe(true)
  })

  it('detects no change (both null)', () => {
    const c = computeChange(null, null)
    expect(c.changed).toBe(false)
  })
})

describe('computeChange — nested maps', () => {
  it('detects a key added, changed or removed inside a nested map', () => {
    expect(computeChange({ args: { A: '1' } } as any, { args: { A: '1', B: '2' } } as any).changed).toBe(true)
    expect(computeChange({ args: { A: '1' } } as any, { args: { A: '2' } } as any).changed).toBe(true)
    expect(computeChange({ args: { A: '1', B: '2' } } as any, { args: { A: '1' } } as any).changed).toBe(true)
    expect(computeChange({ args: { A: '1' } } as any, { args: { A: '1' } } as any).changed).toBe(false)
  })
})

describe('computeAdditiveChange — nested maps', () => {
  it('adds and changes count, a nested key only on the server does not', () => {
    expect(computeAdditiveChange({ args: { A: '1' } }, { args: { A: '1', B: '2' } }).changed).toBe(true)
    expect(computeAdditiveChange({ args: { A: '1' } }, { args: { A: '2' } }).changed).toBe(true)
    expect(computeAdditiveChange({ args: { A: '1', X: '9' } }, { args: { A: '1' } }).changed).toBe(false)
  })
})
