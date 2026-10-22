import { describe, it, expect } from 'vitest'
import { undeclaredEnvKeys } from './env-notes.js'

const base = { declared: [], links: [], external: [], globalFile: {}, globalServer: {} }

describe('undeclaredEnvKeys', () => {
  it('notes a hand-set key by name', () => {
    expect(undeclaredEnvKeys({ ...base, env: { HAND_SET: 'secret' } })).toEqual([{ key: 'HAND_SET' }])
  })

  it('skips the marker and every key it names, and keys the file declares', () => {
    const env = { DOKKU_COMPOSE_MANAGED_KEYS: 'A,B', A: '1', B: '2', C: '3', D: '4' }
    expect(undeclaredEnvKeys({ ...base, env, declared: ['C'] })).toEqual([{ key: 'D' }])
  })

  it('skips the variables of a declared link, by URL host, including the alternate name', () => {
    const env = {
      READ_DB: 'postgres://u:p@dokku-mysql-reports:3306/db',
      DOKKU_MYSQL_AQUA_URL: 'mysql://u:p@dokku-mysql-reports:3306/db',
      OTHER: 'mysql://u:p@elsewhere:3306/db',
    }
    expect(undeclaredEnvKeys({ ...base, env, links: [{ plugin: 'mysql', service: 'reports' }] })).toEqual([{ key: 'OTHER' }])
  })

  it('skips postgres and redis link URLs of services the file does not declare', () => {
    const env = { DATABASE_URL: 'postgres://u:p@dokku-postgres-legacy:5432/db', REDIS_URL: 'redis://:p@dokku-redis-cache:6379', API_URL: 'https://api.example.com' }
    expect(undeclaredEnvKeys({ ...base, env })).toEqual([{ key: 'API_URL' }])
  })

  it('skips GIT_REV, NO_VHOST and DOKKU_* but notes DOKKU_START_CMD', () => {
    const env = { GIT_REV: 'abc', NO_VHOST: '1', DOKKU_APP_TYPE: 'dockerfile', DOKKU_PROXY_PORT: '80', DOKKU_START_CMD: 'bin/web' }
    expect(undeclaredEnvKeys({ ...base, env })).toEqual([{ key: 'DOKKU_START_CMD' }])
  })

  it('skips keys listed in env_external', () => {
    expect(undeclaredEnvKeys({ ...base, env: { SET_BY_SCRIPT: 'x', HAND: 'y' }, external: ['SET_BY_SCRIPT'] })).toEqual([{ key: 'HAND' }])
  })

  it('labels a key equal to the global value the file declares', () => {
    const env = { TZ: 'UTC', LOCALE: 'fr', REGION: 'eu' }
    const notes = undeclaredEnvKeys({ ...base, env, globalFile: { TZ: 'UTC', LOCALE: 'en' }, globalServer: { TZ: 'UTC', LOCALE: 'en', REGION: 'eu' } })
    expect(notes).toEqual([{ key: 'TZ', label: 'duplicate of global' }, { key: 'LOCALE' }, { key: 'REGION' }])
  })
})
