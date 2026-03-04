import { describe, it, expect } from 'vitest'
import { parseConfig } from './schema.js'

describe('parseConfig', () => {
  it('parses minimal config', () => {
    const result = parseConfig({
      apps: { myapp: { ports: ['http:80:3000'] } }
    })
    expect(result.apps['myapp'].ports).toEqual(['http:80:3000'])
  })

  it('rejects invalid port format', () => {
    expect(() => parseConfig({
      apps: { myapp: { ports: ['80:3000'] } }
    })).toThrow()
  })

  it('allows env: false', () => {
    const result = parseConfig({ apps: { myapp: { env: false } } })
    expect(result.apps['myapp'].env).toBe(false)
  })
})
