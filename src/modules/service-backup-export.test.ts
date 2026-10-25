import { describe, it, expect, vi, afterEach } from 'vitest'
import { exportServiceBackup, backupNotes } from './service-backup.js'
import { fakeContext, serviceInfoJson } from '../tests/fake-server.js'

const scheduled = { 'backup-schedule': '0 * * * *', 'backup-bucket': 'backups/api', 'backup-authenticated': 'true' }
const PLACEHOLDERS = { access_key_id: 'REPLACE_ME', secret_access_key: 'REPLACE_ME', region: 'REPLACE_ME', signature_version: 'REPLACE_ME', endpoint: 'REPLACE_ME' }

afterEach(() => vi.restoreAllMocks())

describe.each(['postgres', 'redis'] as const)('%s export of backups', plugin => {
  const exported = (info: Record<string, string>) => {
    const { ctx } = fakeContext({ checks: {}, queries: { [`${plugin}:info api --format json`]: serviceInfoJson('api', plugin, '1', info) } })
    return exportServiceBackup(ctx, plugin, 'api')
  }

  it('reads schedule and bucket from info and writes every credential as REPLACE_ME', async () => {
    expect(await exported(scheduled)).toEqual({ schedule: '0 * * * *', bucket: 'backups/api', auth: PLACEHOLDERS })
  })

  it('writes nothing for a service with no backup', async () => {
    expect(await exported({})).toBeUndefined()
  })

  it('writes a passphrase as REPLACE_ME, never the fingerprint', async () => {
    const out = await exported({ ...scheduled, 'backup-encryption-fingerprint': 'abc123', 'backup-encrypted': 'true' })
    expect(out!.encryption).toEqual({ passphrase: 'REPLACE_ME' })
  })

  it('writes the real public key id and keyserver, which win over a passphrase', async () => {
    const out = await exported({ ...scheduled, 'backup-encryption-fingerprint': 'abc123', 'backup-public-key-id': 'ABCD1234', 'backup-keyserver': 'hkp://keys.example.com' })
    expect(out!.encryption).toEqual({ public_key_id: 'ABCD1234', keyserver: 'hkp://keys.example.com' })
  })

  it('writes the settings the server holds', async () => {
    const out = await exported({ ...scheduled, 'backup-storage-class': 'STANDARD_IA', 'backup-object-name': 'db/latest', 'backup-mailto': 'ops@example.com', 'backup-timestamp': 'false' })
    expect(out).toMatchObject({ storage_class: 'STANDARD_IA', object_name: 'db/latest', mailto: 'ops@example.com', timestamp: false })
  })

  it('writes no block, and warns, for encryption or settings without a default schedule', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await exported({ 'backup-encryption-fingerprint': 'abc123', 'backup-mailto': 'ops@example.com' })).toBeUndefined()
    expect(warn.mock.calls.map(c => String(c[0])).join('\n')).toContain('no default schedule')
  })

  it('leaves the backup out and warns when the info read fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { ctx } = fakeContext({ checks: {}, queries: {} })
    expect(await exportServiceBackup(ctx, plugin, 'api')).toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })
})

describe('backupNotes', () => {
  const info = (o: Record<string, string>) => JSON.parse(serviceInfoJson('api', 'postgres', '1', o))
  const base = { schedule: '0 * * * *', bucket: 'b', auth: PLACEHOLDERS }

  it('says nothing for a service in sync', () => {
    expect(backupNotes(info(scheduled), base)).toEqual([])
  })

  it('notes encryption and settings on the server that the file leaves out', () => {
    const notes = backupNotes(info({ ...scheduled, 'backup-encryption-fingerprint': 'x', 'backup-mailto': 'a@example.com' }), base)
    expect(notes).toEqual([
      'backup encryption on the server is not in the file; up leaves it, encryption: false removes it',
      'backup mailto on the server is not in the file; up leaves it, up --prune clears it',
    ])
  })

  it('notes other schedules only where the plugin reports them', () => {
    expect(backupNotes(info(scheduled), base)).toEqual([])
    expect(backupNotes(info({ ...scheduled, 'backup-schedules': 'default|0 * * * *|b|false;monthly|@monthly|c|false' }), base))
      .toEqual(['other backup schedules (monthly) are not managed; up never touches them'])
  })

  it('notes an undeclared backup, encryption included', () => {
    expect(backupNotes(info({ 'backup-encryption-fingerprint': 'x' }), undefined)[0]).toContain('backup on the server is not in the file (encrypted)')
  })
})
