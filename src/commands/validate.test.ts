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
    expect(result.errors.some(e => e.includes('not defined in postgres or redis'))).toBe(true)
  })

  it('rejects alias together with env_var', () => {
    const result = validate(path.join(FIXTURES, 'invalid_link_options.yml'))
    expect(result.errors.some(e => e.includes('cannot be combined'))).toBe(true)
  })

  it('rejects an unknown key in a link', () => {
    const result = validate(path.join(FIXTURES, 'invalid_link_key.yml'))
    expect(result.errors.some(e => e.includes('aliass'))).toBe(true)
  })

  it('names an unknown top-level key without an empty path prefix', () => {
    const result = validate(path.join(FIXTURES, 'invalid_top_level_key.yml'))
    expect(result.errors).toEqual(['Unrecognized key: "x-common"'])
  })

  it('errors on invalid port format', () => {
    const result = validate(path.join(FIXTURES, 'invalid_ports.yml'))
    expect(result.errors.some(e => e.includes('Port must be') || e.includes('invalid port') || e.includes('scheme'))).toBe(true)
  })

  it('rejects an env_external key also in env:, a duplicate entry and the managed marker, naming app and key', () => {
    const result = validate(path.join(FIXTURES, 'invalid_env_external.yml'))
    expect(result.errors).toEqual([
      'apps.myapp.env_external: "APP_ENV" is also in env:',
      'apps.myapp.env_external: "SET_BY_SCRIPT" is listed twice',
      'apps.myapp.env_external: "DOKKU_COMPOSE_MANAGED_KEYS" is dokku-compose\'s own marker',
    ])
  })
})
