import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { ensureServices, ensureServiceBackups, ensureAppLinks, exportServices, exportAppLinks } from './services.js'

describe('ensureServices', () => {
  it('creates service that does not exist', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)  // postgres:exists returns false
    runner.run = vi.fn()
    const ctx = createContext(runner)
    const services = { 'api-postgres': { plugin: 'postgres' } }
    await ensureServices(ctx, services)
    expect(runner.run).toHaveBeenCalledWith('postgres:create', 'api-postgres')
  })

  it('skips service that exists', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensureServices(ctx, { 'api-postgres': { plugin: 'postgres' } })
    expect(runner.run).not.toHaveBeenCalled()
  })

  it('passes --image flag when image specified', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensureServices(ctx, { 'funqtion-db': { plugin: 'postgres', image: 'postgis/postgis' } })
    expect(runner.run).toHaveBeenCalledWith('postgres:create', 'funqtion-db', '--image', 'postgis/postgis')
  })

  it('passes --image-version flag when version specified', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensureServices(ctx, { 'funqtion-db': { plugin: 'postgres', version: '17-3.5' } })
    expect(runner.run).toHaveBeenCalledWith('postgres:create', 'funqtion-db', '--image-version', '17-3.5')
  })

  it('passes both --image and --image-version when both specified', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensureServices(ctx, {
      'funqtion-db': { plugin: 'postgres', image: 'postgis/postgis', version: '17-3.5' }
    })
    expect(runner.run).toHaveBeenCalledWith(
      'postgres:create', 'funqtion-db', '--image', 'postgis/postgis', '--image-version', '17-3.5'
    )
  })
})

describe('ensureAppLinks', () => {
  it('links desired services not yet linked', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)  // nothing linked yet
    runner.run = vi.fn()
    const ctx = createContext(runner)
    const services = { 'api-postgres': { plugin: 'postgres' } }
    await ensureAppLinks(ctx, 'myapp', ['api-postgres'], services)
    expect(runner.run).toHaveBeenCalledWith('postgres:link', 'api-postgres', 'myapp', '--no-restart')
  })

  it('skips service already linked', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)  // already linked
    runner.run = vi.fn()
    const ctx = createContext(runner)
    const services = { 'api-postgres': { plugin: 'postgres' } }
    await ensureAppLinks(ctx, 'myapp', ['api-postgres'], services)
    expect(runner.run).not.toHaveBeenCalled()
  })

  it('unlinks services linked but not in desired list', async () => {
    const runner = createRunner({ dryRun: false })
    // api-postgres is linked but NOT in desired links
    runner.check = vi.fn().mockImplementation(async (...args: string[]) =>
      args[0] === 'postgres:linked' ? true : false
    )
    runner.run = vi.fn()
    const ctx = createContext(runner)
    const allServices = { 'api-postgres': { plugin: 'postgres' } }
    await ensureAppLinks(ctx, 'myapp', [], allServices)
    expect(runner.run).toHaveBeenCalledWith('postgres:unlink', 'api-postgres', 'myapp', '--no-restart')
  })
})

describe('exportServices', () => {
  it('exports postgres service with custom image', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'plugin:list') return 'postgres  0.33.3 enabled  dokku-postgres\nredis  0.20.0 enabled  dokku-redis'
      if (args[0] === 'postgres:list') return 'NAME             VERSION            STATUS   EXPOSED PORTS  LINKS\nqultr-db         postgis/postgis:17-3.5  running  -              qultr'
      if (args[0] === 'postgres:info') return '=====> qultr-db postgres service information\n       Version:             postgis/postgis:17-3.5'
      if (args[0] === 'redis:list') return 'NAME             VERSION            STATUS   EXPOSED PORTS  LINKS'
      return ''
    })
    const ctx = createContext(runner)
    const result = await exportServices(ctx)
    expect(result).toEqual({
      'qultr-db': { plugin: 'postgres', image: 'postgis/postgis', version: '17-3.5' },
    })
  })

  it('exports redis service with default image (no image field)', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'plugin:list') return 'postgres  0.33.3 enabled  dokku-postgres\nredis  0.20.0 enabled  dokku-redis'
      if (args[0] === 'postgres:list') return 'NAME             VERSION            STATUS   EXPOSED PORTS  LINKS'
      if (args[0] === 'redis:list') return 'NAME             VERSION            STATUS   EXPOSED PORTS  LINKS\nqultr-redis      redis:7.2-alpine   running  -              qultr'
      if (args[0] === 'redis:info') return '=====> qultr-redis redis service information\n       Version:             redis:7.2-alpine'
      return ''
    })
    const ctx = createContext(runner)
    const result = await exportServices(ctx)
    expect(result).toEqual({
      'qultr-redis': { plugin: 'redis', version: '7.2-alpine' },
    })
  })

  it('skips plugins not installed', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'plugin:list') return 'nginx-vhosts  built-in'
      return ''
    })
    const ctx = createContext(runner)
    const result = await exportServices(ctx)
    expect(result).toEqual({})
  })

  it('exports multiple services across plugins', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'plugin:list') return 'postgres  0.33.3 enabled  dokku-postgres\nredis  0.20.0 enabled  dokku-redis'
      if (args[0] === 'postgres:list') return 'NAME             VERSION            STATUS   EXPOSED PORTS  LINKS\napp-db           postgres:16        running  -              app'
      if (args[0] === 'postgres:info') return '=====> app-db postgres service information\n       Version:             postgres:16'
      if (args[0] === 'redis:list') return 'NAME             VERSION            STATUS   EXPOSED PORTS  LINKS\napp-redis        redis:7.2-alpine   running  -              app'
      if (args[0] === 'redis:info') return '=====> app-redis redis service information\n       Version:             redis:7.2-alpine'
      return ''
    })
    const ctx = createContext(runner)
    const result = await exportServices(ctx)
    expect(result).toEqual({
      'app-db': { plugin: 'postgres', version: '16' },
      'app-redis': { plugin: 'redis', version: '7.2-alpine' },
    })
  })
})

describe('ensureServiceBackups', () => {
  const backupConfig = {
    schedule: '0 * * * *',
    bucket: 'db-backups/funqtion-db',
    auth: {
      access_key_id: 'KEY123',
      secret_access_key: 'SECRET456',
      region: 'auto',
      signature_version: 's3v4',
      endpoint: 'https://r2.example.com',
    },
  }

  it('configures backup for a service with backup config', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    runner.query = vi.fn().mockResolvedValue('')  // no stored hash → run backup
    const ctx = createContext(runner)
    const services = { 'funqtion-db': { plugin: 'postgres', backup: backupConfig } }
    await ensureServiceBackups(ctx, services)
    expect(runner.run).toHaveBeenCalledWith('postgres:backup-deauth', 'funqtion-db')
    expect(runner.run).toHaveBeenCalledWith(
      'postgres:backup-auth', 'funqtion-db',
      'KEY123', 'SECRET456', 'auto', 's3v4', 'https://r2.example.com'
    )
    expect(runner.run).toHaveBeenCalledWith(
      'postgres:backup-schedule', 'funqtion-db',
      '0 * * * *', 'db-backups/funqtion-db'
    )
  })

  it('skips services without backup config', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    const ctx = createContext(runner)
    const services = { 'funqtion-redis': { plugin: 'redis' } }
    await ensureServiceBackups(ctx, services)
    expect(runner.run).not.toHaveBeenCalled()
  })

  it('skips backup configuration when hash matches stored hash', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    const backup = {
      schedule: '0 * * * *',
      bucket: 'db-backups/funqtion-db',
      auth: {
        access_key_id: 'KEY123',
        secret_access_key: 'SECRET456',
        region: 'auto',
        signature_version: 's3v4',
        endpoint: 'https://r2.example.com',
      },
    }
    // Compute the expected hash the same way the implementation will
    const { createHash } = await import('crypto')
    const hash = createHash('sha256').update(JSON.stringify(backup)).digest('hex')
    runner.query = vi.fn().mockResolvedValue(hash)
    const ctx = createContext(runner)
    const services = { 'funqtion-db': { plugin: 'postgres', backup } }
    await ensureServiceBackups(ctx, services)
    expect(runner.run).not.toHaveBeenCalled()
  })

  it('runs backup configuration and stores hash when hash differs', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    runner.query = vi.fn().mockResolvedValue('old-hash-value')
    const ctx = createContext(runner)
    const backup = {
      schedule: '0 * * * *',
      bucket: 'db-backups/funqtion-db',
      auth: {
        access_key_id: 'KEY123',
        secret_access_key: 'SECRET456',
        region: 'auto',
        signature_version: 's3v4',
        endpoint: 'https://r2.example.com',
      },
    }
    const services = { 'funqtion-db': { plugin: 'postgres', backup } }
    await ensureServiceBackups(ctx, services)
    expect(runner.run).toHaveBeenCalledWith('postgres:backup-deauth', 'funqtion-db')
    expect(runner.run).toHaveBeenCalledWith('postgres:backup-auth', 'funqtion-db', 'KEY123', 'SECRET456', 'auto', 's3v4', 'https://r2.example.com')
    expect(runner.run).toHaveBeenCalledWith('postgres:backup-schedule', 'funqtion-db', '0 * * * *', 'db-backups/funqtion-db')
    // Verify the new hash is stored
    const { createHash } = await import('crypto')
    const expectedHash = createHash('sha256').update(JSON.stringify(backup)).digest('hex')
    expect(runner.run).toHaveBeenCalledWith('config:set', '--global', `DOKKU_COMPOSE_BACKUP_HASH_FUNQTION_DB=${expectedHash}`)
  })

  it('runs backup configuration when no hash stored yet', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    runner.query = vi.fn().mockResolvedValue('')  // no stored hash
    const ctx = createContext(runner)
    const backup = {
      schedule: '0 * * * *',
      bucket: 'db-backups/funqtion-db',
      auth: {
        access_key_id: 'KEY123',
        secret_access_key: 'SECRET456',
        region: 'auto',
        signature_version: 's3v4',
        endpoint: 'https://r2.example.com',
      },
    }
    const services = { 'funqtion-db': { plugin: 'postgres', backup } }
    await ensureServiceBackups(ctx, services)
    expect(runner.run).toHaveBeenCalledWith('postgres:backup-deauth', 'funqtion-db')
  })
})

describe('exportAppLinks', () => {
  it('returns list of linked service names', async () => {
    const runner = createRunner({ dryRun: false })
    // api-postgres is linked, api-redis is not
    runner.check = vi.fn().mockImplementation(async (...args: string[]) =>
      args[0] === 'postgres:linked' ? true : false
    )
    const ctx = createContext(runner)
    const services = {
      'api-postgres': { plugin: 'postgres' },
      'api-redis': { plugin: 'redis' },
    }
    const result = await exportAppLinks(ctx, 'myapp', services)
    expect(result).toEqual(['api-postgres'])
  })

  it('returns empty array when no services linked', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    const ctx = createContext(runner)
    const services = { 'api-postgres': { plugin: 'postgres' } }
    const result = await exportAppLinks(ctx, 'myapp', services)
    expect(result).toEqual([])
  })
})
