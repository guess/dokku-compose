import { describe, it, expect, vi } from 'vitest'
import { ensureServiceBackups } from './service-backup.js'
import { maskSensitiveArgs } from '../core/mask.js'
import { fakeContext, serviceInfoJson } from '../tests/fake-server.js'

describe('ensureServiceBackups (postgres)', () => {
  const backup = {
    schedule: '0 * * * *',
    bucket: 'db-backups/api-db',
    auth: {
      access_key_id: 'KEY',
      secret_access_key: 'SECRET',
      region: 'auto',
      signature_version: 's3v4',
      endpoint: 'https://r2.example.com',
    },
  }
  // printf 'KEY\nSECRET' | shasum -a 256
  const FP = '367b0dd6299da53d84c87a01b0519aed571f65b54ed7d95687fbbaf6760462b3'
  const configured = {
    'backup-schedule': '0 * * * *', 'backup-bucket': 'db-backups/api-db', 'backup-authenticated': 'true',
    'backup-auth-fingerprint': FP, 'backup-default-region': 'auto', 'backup-signature-version': 's3v4',
    'backup-endpoint-url': 'https://r2.example.com',
  }
  const CRON = '0 * * * * dokku /usr/bin/dokku postgres:backup api-db db-backups/api-db'

  function server(info: Record<string, string>, extra: Record<string, string> = {}) {
    return fakeContext({
      checks: {},
      queries: {
        'postgres:info api-db --format json': serviceInfoJson('api-db', 'postgres', '17', info),
        'postgres:backup-schedule-cat api-db': CRON,
        ...extra,
      },
    })
  }

  it('plans auth and schedule without reading a service created only by this dry run', async () => {
    const { ctx, runner } = fakeContext({ checks: {}, queries: {} })
    await ensureServiceBackups(ctx, 'postgres', { 'new-db': { backup } }, { dryRunCreated: new Set(['new-db']) })
    expect(runner.dryRunLog).toEqual([
      'postgres:backup-auth new-db KEY SECRET auto s3v4 https://r2.example.com',
      "postgres:backup-schedule new-db '0 * * * *' db-backups/api-db",
    ])
  })

  it('runs no command when the server matches the file', async () => {
    const { ctx, runner } = server(configured)
    await ensureServiceBackups(ctx, 'postgres', { 'api-db': { backup } })
    expect(runner.dryRunLog).toEqual([])
  })

  it('authenticates and schedules a service with no backup, never deauthing first', async () => {
    const { ctx, runner } = server({})
    await ensureServiceBackups(ctx, 'postgres', { 'api-db': { backup } })
    expect(runner.dryRunLog).toEqual([
      'postgres:backup-auth api-db KEY SECRET auto s3v4 https://r2.example.com',
      "postgres:backup-schedule api-db '0 * * * *' db-backups/api-db",
    ])
  })

  it('re-authenticates only when the key pair fingerprint differs (rotated key)', async () => {
    const { ctx, runner } = server(configured)
    const rotated = { ...backup, auth: { ...backup.auth, access_key_id: 'KEY2' } }
    await ensureServiceBackups(ctx, 'postgres', { 'api-db': { backup: rotated } })
    expect(runner.dryRunLog).toEqual(['postgres:backup-auth api-db KEY2 SECRET auto s3v4 https://r2.example.com'])
  })

  it('re-authenticates when the endpoint differs', async () => {
    const { ctx, runner } = server({ ...configured, 'backup-endpoint-url': 'https://old.example.com' })
    await ensureServiceBackups(ctx, 'postgres', { 'api-db': { backup } })
    expect(runner.dryRunLog).toHaveLength(1)
    expect(runner.dryRunLog[0]).toStartWith('postgres:backup-auth api-db')
  })

  it('a changed schedule runs backup-schedule only', async () => {
    const { ctx, runner } = server({ ...configured, 'backup-schedule': '0 3 * * *' })
    await ensureServiceBackups(ctx, 'postgres', { 'api-db': { backup } })
    expect(runner.dryRunLog).toEqual(["postgres:backup-schedule api-db '0 * * * *' db-backups/api-db"])
  })

  it('a changed bucket runs postgres:set backup-bucket, with no re-auth', async () => {
    const { ctx, runner } = server({ ...configured, 'backup-bucket': 'old-bucket/api-db' })
    await ensureServiceBackups(ctx, 'postgres', { 'api-db': { backup } })
    expect(runner.dryRunLog).toEqual(['postgres:set api-db backup-bucket db-backups/api-db'])
  })

  it('throws when the schedule did not land', async () => {
    const { ctx } = server({}, { 'postgres:backup-schedule-cat api-db': '' })
    await expect(ensureServiceBackups(ctx, 'postgres', { 'api-db': { backup } })).rejects.toThrow('was not installed')
  })

  it('a dry-run plans a new schedule without checking that it landed', async () => {
    const { ctx, runner } = server({ ...configured, 'backup-schedule': '', 'backup-bucket': '' }, { 'postgres:backup-schedule-cat api-db': '' })
    await ensureServiceBackups(ctx, 'postgres', { 'api-db': { backup } }, { dryRun: true })
    expect(runner.dryRunLog).toEqual(["postgres:backup-schedule api-db '0 * * * *' db-backups/api-db"])
  })

  it('backup: false unschedules, then deauths', async () => {
    const { ctx, runner } = server(configured)
    await ensureServiceBackups(ctx, 'postgres', { 'api-db': { backup: false } })
    expect(runner.dryRunLog).toEqual(['postgres:backup-unschedule api-db --id default', 'postgres:backup-deauth api-db'])
  })

  it('backup: false runs nothing when the server has no backup', async () => {
    const { ctx, runner } = server({})
    await ensureServiceBackups(ctx, 'postgres', { 'api-db': { backup: false } })
    expect(runner.dryRunLog).toEqual([])
  })

  it('an absent backup: never removes one, and --prune only warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { ctx, runner } = server(configured)
    await ensureServiceBackups(ctx, 'postgres', { 'api-db': {} }, { prune: true })
    expect(runner.dryRunLog).toEqual([])
    expect(warn.mock.calls.map(c => String(c[0])).join('\n')).toContain('backup: false')
    warn.mockRestore()
  })

  it('throws on a plugin too old to report backup state, instead of re-applying every run', async () => {
    const { ctx, runner } = fakeContext({ checks: {}, queries: {
      'postgres:info api-db --format json': JSON.stringify({ image: 'postgres', 'image-version': '17' }),
    } })
    await expect(ensureServiceBackups(ctx, 'postgres', { 'api-db': { backup } })).rejects.toThrow('dokku-postgres too old to report backup state (needs 2.3.1+)')
    expect(runner.dryRunLog).toEqual([])
  })

  it('compares the trimmed first line of each credential, as Dokku stores it', async () => {
    const { ctx, runner } = server(configured)
    const padded = { ...backup, auth: { ...backup.auth, access_key_id: ' KEY\n', secret_access_key: 'SECRET \n' } }
    await ensureServiceBackups(ctx, 'postgres', { 'api-db': { backup: padded } })
    expect(runner.dryRunLog).toEqual([])
  })

  it('--prune with an absent backup warns and carries on when the info read fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { ctx, runner } = fakeContext({ checks: {}, queries: {} })
      await ensureServiceBackups(ctx, 'postgres', { 'api-db': {} }, { prune: true })
      expect(runner.dryRunLog).toEqual([])
      expect(warn.mock.calls.map(c => String(c[0])).join('\n')).toContain('could not read backup state for api-db')
    } finally { warn.mockRestore() }
  })

  it('never prints the credentials: logs carry none and the dry-run listing masks them', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { ctx, runner } = server({})
    const secret = { ...backup, auth: { ...backup.auth, access_key_id: 'AKIAEXAMPLE1234', secret_access_key: 'verysecretvalue99' } }
    await ensureServiceBackups(ctx, 'postgres', { 'api-db': { backup: secret } })
    const out = [...runner.dryRunLog.map(maskSensitiveArgs), ...log.mock.calls.map(c => c.join(' '))].join('\n')
    expect(out).not.toContain('AKIAEXAMPLE1234')
    expect(out).not.toContain('verysecretvalue99')
    log.mockRestore()
  })
})

