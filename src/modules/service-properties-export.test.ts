import { describe, it, expect } from 'vitest'
import { exportServiceProperties } from './service-properties.js'
import { fakeContext, serviceInfoJson } from '../tests/fake-server.js'
import { exportPostgres } from './postgres.js'
import { exportRedis } from './redis.js'
import { parseConfig } from '../core/schema.js'
import { maskSensitiveData } from '../core/mask.js'

describe.each(['postgres', 'redis'] as const)('%s export of properties and mounts', plugin => {
  const exported = (info: Record<string, string>) => {
    const { ctx } = fakeContext({ checks: {}, queries: { [`${plugin}:info api --format json`]: serviceInfoJson('api', plugin, '1', info) } })
    return exportServiceProperties(ctx, plugin, 'api')
  }

  it('writes nothing for a service with every property at its default', async () => {
    expect(await exported({})).toEqual({})
  })

  it('writes each non-default managed property with its type: numbers, lists, strings', async () => {
    expect(await exported({
      memory: '512', 'wait-timeout': '90', 'shm-size': '256m', 'restart-policy': 'unless-stopped', 'log-driver': 'json-file',
      'log-opt': 'max-size=10m,max-file=3', 'post-create-network': 'a,b', 'post-start-network': 'c', 'initial-network': 'n',
      'config-options': '--appendonly yes',
    })).toEqual({
      properties: {
        'initial-network': 'n', 'post-create-network': ['a', 'b'], 'post-start-network': ['c'], 'log-driver': 'json-file',
        'log-opt': ['max-size=10m', 'max-file=3'], 'restart-policy': 'unless-stopped', 'wait-timeout': 90,
        'config-options': '--appendonly yes', memory: 512, 'shm-size': '256m',
      },
    })
  })

  it('skips memory 0 and an empty value', async () => {
    expect(await exported({ memory: '0', 'log-driver': '' })).toEqual({})
  })

  it('never writes the password or its fingerprint, and writes every custom-env value as REPLACE_ME', async () => {
    const out = await exported({ 'password-fingerprint': 'a'.repeat(64), 'custom-env': 'TZ=UTC;API_KEY=zq7wxk9' })
    expect(out).toEqual({ properties: { 'custom-env': { TZ: 'REPLACE_ME', API_KEY: 'REPLACE_ME' } } })
    expect(JSON.stringify(out)).not.toMatch(/aaaa|zq7|UTC/)
  })

  it('writes only keys it manages: not backup, expose, unknown or read-only info keys', async () => {
    const out = await exported({ 'backup-bucket': 'b', 'expose-mode': 'direct', 'port-bind-address': '127.0.0.1', 'some-future-key': 'x', status: 'running' })
    expect(out).toEqual({})
  })

  it('writes volume-targets as a map', async () => {
    expect(await exported({ 'volume-targets': 'data=/var/lib/x backups=/srv/b' })).toEqual({
      properties: { 'volume-targets': { backups: '/srv/b', data: '/var/lib/x' } },
    })
  })

  it('writes the mounts as a normalised sorted list', async () => {
    expect(await exported({ mounts: 'vol:/data:ro /srv/a:/opt/a' })).toEqual({ mounts: ['/srv/a:/opt/a', 'vol:/data:ro'] })
  })

  it('writes neither when the info cannot be read', async () => {
    const { ctx } = fakeContext({ checks: {}, queries: {} })
    expect(await exportServiceProperties(ctx, plugin, 'api')).toEqual({})
  })

  it('is masked as the export is: custom-env values stay REPLACE_ME and are not hidden', async () => {
    const out = await exported({ 'custom-env': 'TZ=UTC' })
    expect(maskSensitiveData(out)).toEqual(out)
  })
})

describe('the service export includes them, and the file only needs its secrets replaced', () => {
  it('postgres and redis', async () => {
    for (const [plugin, exportAll] of [['postgres', exportPostgres], ['redis', exportRedis]] as const) {
      const { ctx } = fakeContext({
        checks: {},
        queries: {
          [`${plugin}:list`]: `=====> ${plugin} services\napi`,
          [`${plugin}:info api`]: 'Version: x:1',
          [`${plugin}:info api --format json`]: serviceInfoJson('api', plugin, '1', { memory: '512', 'custom-env': 'TZ=UTC', mounts: '/srv/a:/opt/a' }),
        },
      })
      const services = await exportAll(ctx)
      expect(services.api).toMatchObject({ properties: { memory: 512, 'custom-env': { TZ: 'REPLACE_ME' } }, mounts: ['/srv/a:/opt/a'] })
      // an exported file cannot be applied before the placeholder is replaced
      expect(() => parseConfig({ apps: {}, [plugin]: services })).toThrow('REPLACE_ME')
      const filled = { ...services.api, properties: { ...services.api.properties, 'custom-env': { TZ: 'UTC' } } }
      expect(() => parseConfig({ apps: {}, [plugin]: { api: filled } })).not.toThrow()
    }
  })
})
