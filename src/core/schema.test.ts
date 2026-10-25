import { describe, it, expect } from 'vitest'
import { parseConfig } from './schema.js'

describe('git config in schema', () => {
  it('accepts global git.deploy_branch', () => {
    const result = parseConfig({
      apps: {},
      git: { deploy_branch: 'main' },
    })
    expect(result.git?.deploy_branch).toBe('main')
  })

  it('accepts per-app git.deploy_branch', () => {
    const result = parseConfig({
      apps: { myapp: { git: { deploy_branch: 'develop' } } },
    })
    expect(result.apps.myapp.git?.deploy_branch).toBe('develop')
  })
})

describe('PostgresSchema backup', () => {
  it('accepts a postgres service with backup config', () => {
    const result = parseConfig({
      apps: {},
      postgres: {
        'myapp-db': {
          backup: {
            schedule: '0 * * * *',
            bucket: 'db-backups/myapp-db',
            auth: {
              access_key_id: 'KEY',
              secret_access_key: 'SECRET',
              region: 'auto',
              signature_version: 's3v4',
              endpoint: 'https://r2.example.com',
            },
          },
        },
      },
    })
    expect(result.postgres?.['myapp-db']?.backup?.schedule).toBe('0 * * * *')
  })

  it('accepts a postgres service without backup config', () => {
    const result = parseConfig({
      apps: {},
      postgres: { 'myapp-db': {} },
    })
    expect(result.postgres?.['myapp-db']?.backup).toBeUndefined()
  })

  it('accepts backup: false, which removes the backup', () => {
    const result = parseConfig({ apps: {}, postgres: { 'myapp-db': { backup: false } } })
    expect(result.postgres?.['myapp-db']?.backup).toBe(false)
  })

  it('rejects backup: true', () => {
    expect(() => parseConfig({ apps: {}, postgres: { 'myapp-db': { backup: true } } })).toThrow()
  })
})

describe('docker_auth in schema', () => {
  it('accepts docker_auth with username and password', () => {
    const result = parseConfig({
      apps: {},
      docker_auth: {
        'ghcr.io': { username: 'octocat', password: 'ghp_secret' },
      },
    })
    expect(result.docker_auth?.['ghcr.io']?.username).toBe('octocat')
    expect(result.docker_auth?.['ghcr.io']?.password).toBe('ghp_secret')
  })

  it('rejects docker_auth entry missing password', () => {
    expect(() => parseConfig({
      apps: {},
      docker_auth: { 'ghcr.io': { username: 'octocat' } },
    })).toThrow()
  })

  it('rejects docker_auth entry with empty password', () => {
    expect(() => parseConfig({
      apps: {},
      docker_auth: { 'ghcr.io': { username: 'octocat', password: '' } },
    })).toThrow()
  })
})

describe('scale in schema', () => {
  it('coerces numeric strings to integers', () => {
    const r = parseConfig({ apps: { myapp: { scale: { web: '2', worker: 1 } } } })
    expect(r.apps['myapp'].scale).toEqual({ web: 2, worker: 1 })
  })
  it('rejects non-numeric strings, negatives and empty strings', () => {
    for (const v of ['x', '-1', '', '1.5', -1]) {
      expect(() => parseConfig({ apps: { myapp: { scale: { web: v } } } })).toThrow()
    }
  })
})

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

describe('dokku.version', () => {
  const parse = (version: unknown) => parseConfig({ dokku: { version }, apps: {} })

  it.each(['0.38.31', '0.38.31-rc1', '10.0.0'])('accepts %s', (v) => {
    expect(parse(v).dokku?.version).toBe(v)
  })

  it.each(['0.38', 'latest', 'v0.38.31', '', '0.38.x'])('rejects %j with a clear message', (v) => {
    expect(() => parse(v)).toThrow(/dokku\.version must start with X\.Y\.Z/)
  })

  it('rejects a YAML number such as 0.38', () => {
    expect(() => parse(0.38)).toThrow(/dokku.version must be a quoted string starting with X.Y.Z/)
  })

  it('accepts a missing version', () => {
    expect(parseConfig({ dokku: {}, apps: {} }).dokku?.version).toBeUndefined()
  })
})

describe('unknown keys are rejected', () => {
  const msg = (raw: unknown) => {
    try { parseConfig(raw) } catch (e) { return (e as Error).message }
    return ''
  }

  it('rejects an unknown app key, naming the key and its path', () => {
    const m = msg({ apps: { web: { domain: ['a.example.com'] } } })
    expect(m).toContain('domain')
    expect(m).toContain('apps')
    expect(m).toContain('web')
  })

  it('rejects locked: true', () => {
    expect(msg({ apps: { web: { locked: true } } })).toContain('locked')
  })

  it('rejects an unknown top-level key', () => {
    expect(msg({ apps: {}, domain: ['a.example.com'] })).toContain('domain')
  })

  it('rejects an unknown postgres service key', () => {
    const m = msg({ apps: {}, postgres: { db: { versoin: '16' } } })
    expect(m).toContain('versoin')
    expect(m).toContain('postgres')
  })

  it('rejects an unknown redis service key', () => {
    expect(msg({ apps: {}, redis: { cache: { tag: '7' } } })).toContain('tag')
  })

  it('rejects unknown keys in nested objects', () => {
    expect(msg({ apps: { web: { build: { dockerfle: 'x' } } } })).toContain('dockerfle')
    expect(msg({ apps: { web: { docker_options: { deplo: [] } } } })).toContain('deplo')
    expect(msg({ apps: { web: { network: { tlds: 'x' } } } })).toContain('tlds')
    expect(msg({ apps: { web: { ssl: { certfile: 'a', keyfile: 'b', extra: 1 } } } })).toContain('extra')
    expect(msg({ apps: {}, dokku: { versoin: '1' } })).toContain('versoin')
  })
})
