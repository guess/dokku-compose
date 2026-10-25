import { describe, it, expect } from 'vitest'
import { maskSensitiveArgs, maskSensitiveArgsList, maskSecretsInText, maskSensitiveData } from './mask.js'

describe('backup passphrase masking', () => {
  it('masks the passphrase of set backup-encryption-passphrase completely, for either plugin', () => {
    expect(maskSensitiveArgs('postgres:set api-db backup-encryption-passphrase hunter2-correct-horse'))
      .toBe('postgres:set api-db backup-encryption-passphrase ****')
    expect(maskSensitiveArgs('redis:set api-cache backup-encryption-passphrase abcd'))
      .toBe('redis:set api-cache backup-encryption-passphrase ****')
  })

  it('masks a quoted passphrase with spaces in the dry-run listing', () => {
    expect(maskSensitiveArgs("postgres:set api-db backup-encryption-passphrase 'two words here'"))
      .toBe('postgres:set api-db backup-encryption-passphrase ****')
  })

  it('masks the passphrase of backup-set-encryption', () => {
    expect(maskSensitiveArgs('postgres:backup-set-encryption api-db hunter2-correct-horse'))
      .toBe('postgres:backup-set-encryption api-db ****')
  })

  it('leaves other set properties alone', () => {
    expect(maskSensitiveArgs('postgres:set api-db backup-storage-class STANDARD_IA'))
      .toBe('postgres:set api-db backup-storage-class STANDARD_IA')
    expect(maskSensitiveArgs('postgres:set api-db backup-public-key-id ABCD1234'))
      .toBe('postgres:set api-db backup-public-key-id ABCD1234')
  })

  it('masks a PASSPHRASE=value pair completely', () => {
    expect(maskSensitiveArgs('config:set myapp BACKUP_PASSPHRASE=hunter2-correct-horse'))
      .toBe('config:set myapp BACKUP_PASSPHRASE=****')
  })

  it('reports the passphrase as a secret and scrubs it out of stderr completely', () => {
    const { masked, secrets, opaque } = maskSensitiveArgsList(['postgres:set', 'api-db', 'backup-encryption-passphrase', 'hunter2-correct-horse'])
    expect(masked).toEqual(['postgres:set', 'api-db', 'backup-encryption-passphrase', '****'])
    expect(secrets).toContain('hunter2-correct-horse')
    const text = maskSecretsInText('bad value hunter2-correct-horse', secrets, opaque)
    expect(text).toBe('bad value ****')
  })

  it('masks the argument of backup-set-encryption in an argv', () => {
    const { masked, opaque } = maskSensitiveArgsList(['redis:backup-set-encryption', 'api-cache', 'hunter2-correct-horse'])
    expect(masked).toEqual(['redis:backup-set-encryption', 'api-cache', '****'])
    expect(opaque).toEqual(['hunter2-correct-horse'])
  })

  it('masks a passphrase key in diff and export data completely, but not the public key id or keyserver', () => {
    const out = maskSensitiveData({
      encryption: { passphrase: 'hunter2-correct-horse' },
      other: { public_key_id: 'ABCD1234ABCD1234', keyserver: 'hkp://keys.example.com' },
      auth: { access_key_id: 'AKIAEXAMPLE1234' },
    }) as any
    expect(out.encryption.passphrase).toBe('****')
    expect(out.other).toEqual({ public_key_id: 'ABCD1234ABCD1234', keyserver: 'hkp://keys.example.com' })
    expect(out.auth.access_key_id).toBe('****1234')
  })

  it('leaves the REPLACE_ME placeholder export writes readable', () => {
    const out = maskSensitiveData({ passphrase: 'REPLACE_ME', secret_access_key: 'REPLACE_ME', access_key_id: 'REPLACE_ME' })
    expect(out).toEqual({ passphrase: 'REPLACE_ME', secret_access_key: 'REPLACE_ME', access_key_id: 'REPLACE_ME' })
  })
})
