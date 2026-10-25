import { describe, it, expect } from 'vitest'
import { parseConfig } from './schema.js'

describe('service backup keys', () => {
  const base = {
    schedule: '0 * * * *', bucket: 'backups/myapp-db',
    auth: { access_key_id: 'KEY', secret_access_key: 'SECRET', region: 'auto', signature_version: 's3v4', endpoint: 'https://r2.example.com' },
  }
  const parse = (backup: unknown, plugin: 'postgres' | 'redis' = 'postgres') =>
    parseConfig({ apps: {}, [plugin]: { svc: { backup } } })
  const issues = (backup: unknown, plugin: 'postgres' | 'redis' = 'postgres') => {
    try { parse(backup, plugin); return '' } catch (e: any) { return String(e.message) }
  }

  it('accepts every optional key on postgres and redis', () => {
    const full = {
      ...base, encryption: { public_key_id: 'ABCD1234', keyserver: 'hkp://keys.example.com' },
      storage_class: 'STANDARD_IA', object_name: 'db/latest', mailto: 'ops@example.com,dba@example.com', timestamp: false,
    }
    expect(parse(full).postgres!.svc.backup).toMatchObject({ storage_class: 'STANDARD_IA', timestamp: false })
    expect(parse(full, 'redis').redis!.svc.backup).toMatchObject({ object_name: 'db/latest' })
  })

  it('accepts a passphrase and encryption: false', () => {
    expect(parse({ ...base, encryption: { passphrase: 'correct horse' } }).postgres!.svc.backup).toBeTruthy()
    expect(parse({ ...base, encryption: false }).postgres!.svc.backup).toBeTruthy()
  })

  it('rejects both encryption forms, an empty one, and a keyserver with a passphrase', () => {
    expect(issues({ ...base, encryption: { passphrase: 'a', public_key_id: 'B' } })).toContain('not both')
    expect(issues({ ...base, encryption: {} })).toContain('passphrase or public_key_id')
    expect(issues({ ...base, encryption: { passphrase: 'a', keyserver: 'hkp://k' } })).toContain('keyserver')
    expect(issues({ ...base, encryption: true })).not.toBe('')
  })

  it('rejects empty and multi-line secrets', () => {
    expect(issues({ ...base, encryption: { passphrase: '' } })).not.toBe('')
    expect(issues({ ...base, encryption: { passphrase: 'a\nb' } })).toContain('single line')
    expect(issues({ ...base, encryption: { public_key_id: 'A\nB' } })).toContain('single line')
  })

  it('rejects the REPLACE_ME placeholder export writes, for the passphrase and the secret auth fields', () => {
    expect(issues({ ...base, encryption: { passphrase: 'REPLACE_ME' } })).toContain('replace the REPLACE_ME placeholder written by export')
    expect(issues({ ...base, auth: { ...base.auth, access_key_id: 'REPLACE_ME' } })).toContain('replace the REPLACE_ME placeholder written by export')
    expect(issues({ ...base, auth: { ...base.auth, secret_access_key: 'REPLACE_ME' } })).toContain('REPLACE_ME')
  })

  it('takes only a storage class the plugin knows', () => {
    for (const c of ['STANDARD', 'REDUCED_REDUNDANCY', 'STANDARD_IA', 'ONEZONE_IA', 'INTELLIGENT_TIERING', 'GLACIER', 'DEEP_ARCHIVE', 'GLACIER_IR']) {
      expect(issues({ ...base, storage_class: c })).toBe('')
    }
    expect(issues({ ...base, storage_class: 'COLD' })).not.toBe('')
  })

  it('checks object_name like the plugin', () => {
    expect(issues({ ...base, object_name: 'a/b.c-d_e' })).toBe('')
    for (const bad of ['', '/a', 'a/', 'a//b', '.', '..', 'a/../b', 'a b', 'a'.repeat(513)]) {
      expect(issues({ ...base, object_name: bad })).not.toBe('')
    }
    expect(issues({ ...base, object_name: 'a'.repeat(512) })).toBe('')
  })

  it('rejects a mailto with spaces and a timestamp other than false', () => {
    expect(issues({ ...base, mailto: 'a@example.com b@example.com' })).not.toBe('')
    expect(issues({ ...base, mailto: '' })).not.toBe('')
    expect(issues({ ...base, timestamp: true })).not.toBe('')
  })
})
