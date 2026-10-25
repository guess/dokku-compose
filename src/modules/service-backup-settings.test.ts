import { createHash } from 'crypto'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ensureServiceBackups, backupMismatches, otherScheduleIds, hasBackup, describeServerBackup } from './service-backup.js'
import { maskSensitiveArgs } from '../core/mask.js'
import { fakeContext, serviceInfoJson } from '../tests/fake-server.js'

const sha = (v: string) => createHash('sha256').update(v).digest('hex')
const FP = '367b0dd6299da53d84c87a01b0519aed571f65b54ed7d95687fbbaf6760462b3'

const base = {
  schedule: '0 * * * *',
  bucket: 'backups/api',
  auth: { access_key_id: 'KEY', secret_access_key: 'SECRET', region: 'auto', signature_version: 's3v4', endpoint: 'https://r2.example.com' },
}
const configured = {
  'backup-schedule': '0 * * * *', 'backup-bucket': 'backups/api', 'backup-authenticated': 'true',
  'backup-auth-fingerprint': FP, 'backup-default-region': 'auto', 'backup-signature-version': 's3v4',
  'backup-endpoint-url': 'https://r2.example.com',
}
const CRON = (plugin: string) => `0 * * * * dokku /usr/bin/dokku ${plugin}:backup api backups/api`

function server(plugin: 'postgres' | 'redis', info: Record<string, string>, extra: Record<string, string> = {}) {
  return fakeContext({
    checks: {},
    queries: {
      [`${plugin}:info api --format json`]: serviceInfoJson('api', plugin, '1', info),
      [`${plugin}:backup-schedule-cat api`]: CRON(plugin),
      ...extra,
    },
  })
}

afterEach(() => vi.restoreAllMocks())

describe.each(['postgres', 'redis'] as const)('%s backup encryption and settings', plugin => {
  const run = async (info: Record<string, string>, backup: any, opts = {}) => {
    const { ctx, runner } = server(plugin, info)
    await ensureServiceBackups(ctx, plugin, { api: { backup } }, opts)
    return runner.dryRunLog
  }

  it('sets a passphrase and clears the public key and keyserver stored beside it', async () => {
    const log = await run({ ...configured, 'backup-public-key-id': 'AAAA', 'backup-keyserver': 'hkp://old' }, { ...base, encryption: { passphrase: 'correct horse' } })
    expect(log).toEqual([
      `${plugin}:set api backup-encryption-passphrase 'correct horse'`,
      `${plugin}:set api backup-public-key-id`,
      `${plugin}:set api backup-keyserver`,
    ])
  })

  it('runs nothing when the passphrase fingerprint matches (sha256, no newline)', async () => {
    const log = await run({ ...configured, 'backup-encryption-fingerprint': sha('s3cret'), 'backup-encrypted': 'true' }, { ...base, encryption: { passphrase: 's3cret' } })
    expect(log).toEqual([])
  })

  it('a rotated passphrase is picked up', async () => {
    const log = await run({ ...configured, 'backup-encryption-fingerprint': sha('old') }, { ...base, encryption: { passphrase: 'new' } })
    expect(log).toEqual([`${plugin}:set api backup-encryption-passphrase new`])
  })

  it('sets a public key: keyserver first, then the id, then clears a stored passphrase', async () => {
    const log = await run({ ...configured, 'backup-encryption-fingerprint': sha('old') }, { ...base, encryption: { public_key_id: 'ABCD1234', keyserver: 'hkp://keys.example.com' } })
    expect(log).toEqual([
      `${plugin}:set api backup-keyserver hkp://keys.example.com`,
      `${plugin}:set api backup-public-key-id ABCD1234`,
      `${plugin}:set api backup-encryption-passphrase`,
    ])
  })

  it('compares the public key id and keyserver as exact strings', async () => {
    const same = { ...configured, 'backup-public-key-id': '0xABCD1234', 'backup-keyserver': 'hkp://keys.example.com' }
    expect(await run(same, { ...base, encryption: { public_key_id: '0xABCD1234', keyserver: 'hkp://keys.example.com' } })).toEqual([])
    expect(await run(same, { ...base, encryption: { public_key_id: 'ABCD1234', keyserver: 'hkp://keys.example.com' } }))
      .toEqual([`${plugin}:set api backup-public-key-id ABCD1234`])
  })

  it('clears a stored keyserver when the public key form leaves it out', async () => {
    const log = await run({ ...configured, 'backup-public-key-id': 'ABCD1234', 'backup-keyserver': 'hkp://old' }, { ...base, encryption: { public_key_id: 'ABCD1234' } })
    expect(log).toEqual([`${plugin}:set api backup-keyserver`])
  })

  it('encryption: false clears what is stored, and runs nothing when nothing is', async () => {
    const stored = { ...configured, 'backup-encryption-fingerprint': sha('x'), 'backup-public-key-id': 'AAAA', 'backup-keyserver': 'hkp://k' }
    expect(await run(stored, { ...base, encryption: false })).toEqual([
      `${plugin}:set api backup-encryption-passphrase`,
      `${plugin}:set api backup-public-key-id`,
      `${plugin}:set api backup-keyserver`,
    ])
    expect(await run(configured, { ...base, encryption: false })).toEqual([])
  })

  it('an absent encryption leaves it alone; --prune only warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stored = { ...configured, 'backup-encryption-fingerprint': sha('x'), 'backup-encrypted': 'true' }
    expect(await run(stored, base)).toEqual([])
    expect(await run(stored, base, { prune: true })).toEqual([])
    expect(warn.mock.calls.map(c => String(c[0])).join('\n')).toContain('encryption')
  })

  it('applies storage_class, object_name, mailto and timestamp: false after the encryption', async () => {
    const log = await run(configured, { ...base, encryption: { passphrase: 'p' }, storage_class: 'STANDARD_IA', object_name: 'db/latest', mailto: 'ops@example.com', timestamp: false })
    expect(log).toEqual([
      `${plugin}:set api backup-encryption-passphrase p`,
      `${plugin}:set api backup-storage-class STANDARD_IA`,
      `${plugin}:set api backup-object-name db/latest`,
      `${plugin}:set api backup-mailto ops@example.com`,
      `${plugin}:set api backup-timestamp false`,
    ])
  })

  it('runs nothing when the settings already match, and reads the default timestamp as true', async () => {
    const onServer = { ...configured, 'backup-storage-class': 'STANDARD_IA', 'backup-object-name': 'db/latest', 'backup-mailto': 'ops@example.com', 'backup-timestamp': 'false' }
    expect(await run(onServer, { ...base, storage_class: 'STANDARD_IA', object_name: 'db/latest', mailto: 'ops@example.com', timestamp: false })).toEqual([])
    expect(await run({ ...configured, 'backup-timestamp': 'true' }, { ...base, timestamp: false })).toEqual([`${plugin}:set api backup-timestamp false`])
  })

  it('--prune clears settings the declared block leaves out, never encryption', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onServer = { ...configured, 'backup-storage-class': 'GLACIER', 'backup-mailto': 'a@example.com', 'backup-object-name': 'x', 'backup-timestamp': 'false' }
    expect(await run(onServer, base)).toEqual([])
    expect(await run(onServer, base, { prune: true })).toEqual([
      `${plugin}:set api backup-storage-class`,
      `${plugin}:set api backup-object-name`,
      `${plugin}:set api backup-mailto`,
      `${plugin}:set api backup-timestamp`,
    ])
  })

  it('backup: false unschedules the default schedule, deauths, then clears encryption and settings', async () => {
    const onServer = { ...configured, 'backup-encryption-fingerprint': sha('x'), 'backup-public-key-id': 'AAAA', 'backup-storage-class': 'GLACIER', 'backup-timestamp': 'false' }
    expect(await run(onServer, false)).toEqual([
      `${plugin}:backup-unschedule api --id default`,
      `${plugin}:backup-deauth api`,
      `${plugin}:set api backup-encryption-passphrase`,
      `${plugin}:set api backup-public-key-id`,
      `${plugin}:set api backup-storage-class`,
      `${plugin}:set api backup-timestamp`,
    ])
  })

  it('backup: false removes leftover encryption even when no schedule or credentials remain', async () => {
    expect(await run({ ...configured, 'backup-schedule': '', 'backup-authenticated': 'false', 'backup-auth-fingerprint': '', 'backup-encryption-fingerprint': sha('x') }, false))
      .toEqual([`${plugin}:set api backup-encryption-passphrase`])
  })

  it('a bucket-only change re-runs backup-schedule when another schedule exists', async () => {
    const withOthers = { ...configured, 'backup-bucket': 'old/api', 'backup-schedules': 'default|0 * * * *|old/api|false;monthly|@monthly|b|false' }
    expect(await run(withOthers, base)).toEqual([`${plugin}:backup-schedule api '0 * * * *' backups/api`])
    expect(await run({ ...configured, 'backup-bucket': 'old/api', 'backup-schedules': 'default|0 * * * *|old/api|false' }, base))
      .toEqual([`${plugin}:set api backup-bucket backups/api`])
  })

  it('a service created in this dry run is planned with encryption and settings', async () => {
    const { ctx, runner } = fakeContext({ checks: {}, queries: {} })
    await ensureServiceBackups(ctx, plugin, { api: { backup: { ...base, encryption: { public_key_id: 'ABCD', keyserver: 'hkp://k' }, mailto: 'a@example.com' } } }, { dryRunCreated: new Set(['api']) })
    expect(runner.dryRunLog).toEqual([
      `${plugin}:backup-auth api KEY SECRET auto s3v4 https://r2.example.com`,
      `${plugin}:backup-schedule api '0 * * * *' backups/api`,
      `${plugin}:set api backup-keyserver hkp://k`,
      `${plugin}:set api backup-public-key-id ABCD`,
      `${plugin}:set api backup-mailto a@example.com`,
    ])
  })

  it('never prints the passphrase: the dry-run listing masks it completely', async () => {
    const log = await run(configured, { ...base, encryption: { passphrase: 'hunter2-correct-horse' } })
    expect(log.map(maskSensitiveArgs).join('\n')).not.toContain('hunter2')
    expect(log.map(maskSensitiveArgs)).toEqual([`${plugin}:set api backup-encryption-passphrase ****`])
  })

  it('fails with the plugin name when the plugin cannot report the new settings', async () => {
    const { ctx } = fakeContext({ checks: {}, queries: { [`${plugin}:info api --format json`]: JSON.stringify({ 'backup-auth-fingerprint': FP, 'backup-schedule': '0 * * * *' }) } })
    await expect(ensureServiceBackups(ctx, plugin, { api: { backup: { ...base, mailto: 'a@example.com' } } })).rejects.toThrow(`dokku-${plugin} too old to report backup state (needs 2.3.1+)`)
    // declaring only the 2.2.0-era keys needs no more than the fingerprint
    const ok = fakeContext({ checks: {}, queries: { [`${plugin}:info api --format json`]: JSON.stringify({ ...configured }) } })
    await expect(ensureServiceBackups(ok.ctx, plugin, { api: { backup: base } })).resolves.toBeUndefined()
  })
})

describe('backup state helpers', () => {
  it('lists the ids of schedules other than default, and nothing on a plugin that does not report them', () => {
    expect(otherScheduleIds({})).toEqual([])
    expect(otherScheduleIds({ 'backup-schedules': 'default|0 3 * * *|b|false' })).toEqual([])
    expect(otherScheduleIds({ 'backup-schedules': 'default|0 3 * * *|b|false;frequent|*/15 * * * *|a|false;monthly|@monthly|c|true' })).toEqual(['frequent', 'monthly'])
    expect(otherScheduleIds({ 'backup-schedules': 'monthly|@monthly|c|true' })).toEqual(['monthly'])
  })

  it('counts encryption and settings as a backup the file may not declare', () => {
    expect(hasBackup({ 'backup-timestamp': 'true' })).toBe(false)
    expect(hasBackup({ 'backup-encryption-fingerprint': sha('x') })).toBe(true)
    expect(hasBackup({ 'backup-public-key-id': 'AAAA' })).toBe(true)
    expect(hasBackup({ 'backup-storage-class': 'GLACIER' })).toBe(true)
    expect(hasBackup({ 'backup-timestamp': 'false' })).toBe(true)
    expect(describeServerBackup({ 'backup-encryption-fingerprint': sha('x'), 'backup-mailto': 'a@example.com' })).toBe('encrypted, with mailto set')
  })

  it('reports a passphrase difference without ever naming the passphrase', () => {
    const m = backupMismatches('postgres', { ...configured, 'backup-timestamp': 'true', 'backup-mailto': '', 'backup-encryption-fingerprint': sha('old') }, { ...base, encryption: { passphrase: 'newsecret' } } as any)
    expect(m).toEqual([{ field: 'backup.encryption', desired: 'passphrase', current: 'a different passphrase' }])
    expect(JSON.stringify(m)).not.toContain('newsecret')
  })
})
