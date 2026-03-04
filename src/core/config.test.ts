import { describe, it, expect } from 'vitest'
import { loadConfig } from './config.js'
import path from 'path'

const FIXTURES = path.join(import.meta.dirname, '../tests/fixtures')

describe('loadConfig', () => {
  it('loads and parses simple.yml', () => {
    const config = loadConfig(path.join(FIXTURES, 'simple.yml'))
    expect(Object.keys(config.apps)).toContain('myapp')
    expect(config.apps['myapp'].ports).toEqual(['http:5000:5000'])
  })

  it('throws on missing file', () => {
    expect(() => loadConfig('/nonexistent.yml')).toThrow(/not found/)
  })

  it('throws on invalid YAML', () => {
    expect(() => loadConfig(path.join(FIXTURES, 'invalid.yml'))).toThrow()
  })
})
