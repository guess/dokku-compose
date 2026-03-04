import { describe, it, expect } from 'vitest'
import { validate } from './validate.js'
import path from 'path'

const FIXTURES = path.join(import.meta.dirname, '../tests/fixtures')

describe('validate', () => {
  it('returns no errors for valid simple.yml', () => {
    const result = validate(path.join(FIXTURES, 'simple.yml'))
    expect(result.errors).toHaveLength(0)
  })

  it('returns no errors for valid full.yml', () => {
    const result = validate(path.join(FIXTURES, 'full.yml'))
    expect(result.errors).toHaveLength(0)
  })

  it('errors when app links to undefined service', () => {
    const result = validate(path.join(FIXTURES, 'invalid_links.yml'))
    expect(result.errors.some(e => e.includes('not defined in services'))).toBe(true)
  })

  it('errors on invalid port format', () => {
    const result = validate(path.join(FIXTURES, 'invalid_ports.yml'))
    expect(result.errors.some(e => e.includes('Port must be') || e.includes('invalid port') || e.includes('scheme'))).toBe(true)
  })
})
