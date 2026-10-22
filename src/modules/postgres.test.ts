import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { ensurePostgres, ensurePostgresBackups, destroyPostgres, exportPostgres, removeBackupHashKeys } from './postgres.js'
import { maskSensitiveArgs } from '../core/mask.js'
import { fakeContext, serviceInfoJson } from '../tests/fake-server.js'

describe('ensurePostgres', () => {
  it('creates service that does not exist', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensurePostgres(ctx, { 'api-db': {} })
    expect(runner.run).toHaveBeenCalledWith('postgres:create', 'api-db')
  })

  it('skips service that exists', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensurePostgres(ctx, { 'api-db': {} })
    expect(runner.run).not.toHaveBeenCalled()
  })

  it('passes --image and --image-version flags', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensurePostgres(ctx, { 'api-db': { image: 'postgis/postgis', version: '17-3.5' } })
    expect(runner.run).toHaveBeenCalledWith(
      'postgres:create', 'api-db', '--image', 'postgis/postgis', '--image-version', '17-3.5'
    )
  })
})

describe('ensurePostgresBackups', () => {
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

  it('runs no command when the server matches the file', async () => {
    const { ctx, runner } = server(configured)
    await ensurePostgresBackups(ctx, { 'api-db': { backup } })
    expect(runner.dryRunLog).toEqual([])
  })

  it('authenticates and schedules a service with no backup, never deauthing first', async () => {
    const { ctx, runner } = server({})
    await ensurePostgresBackups(ctx, { 'api-db': { backup } })
    expect(runner.dryRunLog).toEqual([
      'postgres:backup-auth api-db KEY SECRET auto s3v4 https://r2.example.com',
      "postgres:backup-schedule api-db '0 * * * *' db-backups/api-db",
    ])
  })

  it('re-authenticates only when the key pair fingerprint differs (rotated key)', async () => {
    const { ctx, runner } = server(configured)
    const rotated = { ...backup, auth: { ...backup.auth, access_key_id: 'KEY2' } }
    await ensurePostgresBackups(ctx, { 'api-db': { backup: rotated } })
    expect(runner.dryRunLog).toEqual(['postgres:backup-auth api-db KEY2 SECRET auto s3v4 https://r2.example.com'])
  })

  it('re-authenticates when the endpoint differs', async () => {
    const { ctx, runner } = server({ ...configured, 'backup-endpoint-url': 'https://old.example.com' })
    await ensurePostgresBackups(ctx, { 'api-db': { backup } })
    expect(runner.dryRunLog).toHaveLength(1)
    expect(runner.dryRunLog[0]).toStartWith('postgres:backup-auth api-db')
  })

  it('a changed schedule runs backup-schedule only', async () => {
    const { ctx, runner } = server({ ...configured, 'backup-schedule': '0 3 * * *' })
    await ensurePostgresBackups(ctx, { 'api-db': { backup } })
    expect(runner.dryRunLog).toEqual(["postgres:backup-schedule api-db '0 * * * *' db-backups/api-db"])
  })

  it('a changed bucket runs postgres:set backup-bucket, with no re-auth', async () => {
    const { ctx, runner } = server({ ...configured, 'backup-bucket': 'old-bucket/api-db' })
    await ensurePostgresBackups(ctx, { 'api-db': { backup } })
    expect(runner.dryRunLog).toEqual(['postgres:set api-db backup-bucket db-backups/api-db'])
  })

  it('throws when the schedule did not land', async () => {
    const { ctx } = server({}, { 'postgres:backup-schedule-cat api-db': '' })
    await expect(ensurePostgresBackups(ctx, { 'api-db': { backup } })).rejects.toThrow('was not installed')
  })

  it('backup: false unschedules, then deauths', async () => {
    const { ctx, runner } = server(configured)
    await ensurePostgresBackups(ctx, { 'api-db': { backup: false } })
    expect(runner.dryRunLog).toEqual(['postgres:backup-unschedule api-db', 'postgres:backup-deauth api-db'])
  })

  it('backup: false runs nothing when the server has no backup', async () => {
    const { ctx, runner } = server({})
    await ensurePostgresBackups(ctx, { 'api-db': { backup: false } })
    expect(runner.dryRunLog).toEqual([])
  })

  it('an absent backup: never removes one, and --prune only warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { ctx, runner } = server(configured)
    await ensurePostgresBackups(ctx, { 'api-db': {} }, { prune: true })
    expect(runner.dryRunLog).toEqual([])
    expect(warn.mock.calls.map(c => String(c[0])).join('\n')).toContain('backup: false')
    warn.mockRestore()
  })

  it('throws on a plugin too old to report backup state, instead of re-applying every run', async () => {
    const { ctx, runner } = fakeContext({ checks: {}, queries: {
      'postgres:info api-db --format json': JSON.stringify({ image: 'postgres', 'image-version': '17' }),
    } })
    await expect(ensurePostgresBackups(ctx, { 'api-db': { backup } })).rejects.toThrow('needs 2.3.1+')
    expect(runner.dryRunLog).toEqual([])
  })

  it('compares the trimmed first line of each credential, as Dokku stores it', async () => {
    const { ctx, runner } = server(configured)
    const padded = { ...backup, auth: { ...backup.auth, access_key_id: ' KEY\n', secret_access_key: 'SECRET \n' } }
    await ensurePostgresBackups(ctx, { 'api-db': { backup: padded } })
    expect(runner.dryRunLog).toEqual([])
  })

  it('--prune with an absent backup warns and carries on when the info read fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { ctx, runner } = fakeContext({ checks: {}, queries: {} })
      await ensurePostgresBackups(ctx, { 'api-db': {} }, { prune: true })
      expect(runner.dryRunLog).toEqual([])
      expect(warn.mock.calls.map(c => String(c[0])).join('\n')).toContain('could not read backup state for api-db')
    } finally { warn.mockRestore() }
  })

  it('never prints the credentials: logs carry none and the dry-run listing masks them', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { ctx, runner } = server({})
    const secret = { ...backup, auth: { ...backup.auth, access_key_id: 'AKIAEXAMPLE1234', secret_access_key: 'verysecretvalue99' } }
    await ensurePostgresBackups(ctx, { 'api-db': { backup: secret } })
    const out = [...runner.dryRunLog.map(maskSensitiveArgs), ...log.mock.calls.map(c => c.join(' '))].join('\n')
    expect(out).not.toContain('AKIAEXAMPLE1234')
    expect(out).not.toContain('verysecretvalue99')
    log.mockRestore()
  })
})

describe('removeBackupHashKeys', () => {
  it('warns and carries on when the global env cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { ctx, runner } = fakeContext({ checks: {}, queries: {} })
      await removeBackupHashKeys(ctx)
      expect(runner.dryRunLog).toEqual([])
      expect(warn.mock.calls.length).toBe(1)
    } finally { warn.mockRestore() }
  })

  it('unsets every old DOKKU_COMPOSE_BACKUP_HASH_* global, and a second run unsets none', async () => {
    const { ctx, runner } = fakeContext({ checks: {}, queries: {
      'config:export --global --format json': JSON.stringify({ APP_ENV: 'x', DOKKU_COMPOSE_BACKUP_HASH_WEB_DB: 'h', DOKKU_COMPOSE_BACKUP_HASH_API_DB: 'h' }),
    } })
    await removeBackupHashKeys(ctx)
    expect(runner.dryRunLog).toEqual([
      'config:unset --global --no-restart DOKKU_COMPOSE_BACKUP_HASH_API_DB DOKKU_COMPOSE_BACKUP_HASH_WEB_DB',
    ])
    const second = fakeContext({ checks: {}, queries: { 'config:export --global --format json': '{"APP_ENV":"x"}' } })
    await removeBackupHashKeys(second.ctx)
    expect(second.runner.dryRunLog).toEqual([])
  })
})

describe('destroyPostgres', () => {
  it('destroys existing service', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await destroyPostgres(ctx, { 'api-db': {} })
    expect(runner.run).toHaveBeenCalledWith('postgres:destroy', 'api-db', '--force')
  })
})

describe('exportPostgres', () => {
  it('exports with custom image', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'postgres:list') return 'NAME   VERSION   STATUS\napi-db postgis/postgis:17-3.5 running'
      if (args[0] === 'postgres:info') return '=====> api-db\n       Version:             postgis/postgis:17-3.5'
      return ''
    })
    const ctx = createContext(runner)
    const result = await exportPostgres(ctx)
    expect(result).toEqual({ 'api-db': { image: 'postgis/postgis', version: '17-3.5' } })
  })

  it('omits image when it matches default', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'postgres:list') return 'NAME   VERSION   STATUS\napi-db postgres:16 running'
      if (args[0] === 'postgres:info') return '=====> api-db\n       Version:             postgres:16'
      return ''
    })
    const ctx = createContext(runner)
    const result = await exportPostgres(ctx)
    expect(result).toEqual({ 'api-db': { version: '16' } })
  })

  it('exports backup schedule and bucket', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'postgres:list') return 'NAME   VERSION   STATUS\napi-db postgres:16 running'
      if (args[0] === 'postgres:info') return '=====> api-db\n       Version:             postgres:16'
      if (args[0] === 'postgres:backup-schedule-cat')
        return '0 * * * * dokku /usr/bin/dokku postgres:backup api-db db-backups/api-db'
      return ''
    })
    const ctx = createContext(runner)
    const result = await exportPostgres(ctx)
    expect(result['api-db'].backup).toEqual({
      schedule: '0 * * * *',
      bucket: 'db-backups/api-db',
      auth: {
        access_key_id: 'REPLACE_ME',
        secret_access_key: 'REPLACE_ME',
        region: 'REPLACE_ME',
        signature_version: 'REPLACE_ME',
        endpoint: 'REPLACE_ME',
      },
    })
  })

  it('omits backup when no schedule configured', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'postgres:list') return 'NAME   VERSION   STATUS\napi-db postgres:16 running'
      if (args[0] === 'postgres:info') return '=====> api-db\n       Version:             postgres:16'
      if (args[0] === 'postgres:backup-schedule-cat') throw new Error('exit code 1')
      return ''
    })
    const ctx = createContext(runner)
    const result = await exportPostgres(ctx)
    expect(result['api-db'].backup).toBeUndefined()
  })

  it('returns empty when no services', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('NAME   VERSION   STATUS')
    const ctx = createContext(runner)
    const result = await exportPostgres(ctx)
    expect(result).toEqual({})
  })
})
