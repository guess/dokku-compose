import { describe, it, expect } from 'vitest'
import { validate } from './validate.js'
import path from 'path'
import fs from 'fs'
import os from 'os'

describe('validate service properties', () => {
  const write = (body: string) => {
    const file = path.join(os.tmpdir(), `dc-props-${process.pid}-${Math.random().toString(36).slice(2)}.yml`)
    fs.writeFileSync(file, body)
    return file
  }

  it('warns about a key the tested plugin version does not list, and still passes', () => {
    const result = validate(write('postgres:\n  db:\n    properties:\n      memory: 512\n      some-future-key: x\napps: {}\n'))
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([expect.stringContaining('postgres.db.properties.some-future-key: not a postgres:set key of dokku-postgres 2.4.0')])
  })

  it('errors on a rejected key and does not warn about it', () => {
    const result = validate(write('redis:\n  cache:\n    properties:\n      backup-bucket: b\napps: {}\n'))
    expect(result.errors.some(e => e.includes('redis.cache.properties.backup-bucket'))).toBe(true)
    expect(result.warnings).toEqual([])
  })

  it('rejects the REPLACE_ME placeholder as a password', () => {
    const result = validate(write('postgres:\n  db:\n    properties:\n      password: REPLACE_ME\napps: {}\n'))
    expect(result.errors.some(e => e.includes('REPLACE_ME'))).toBe(true)
  })
})
