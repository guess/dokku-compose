import { describe, it, expect } from 'vitest'
import { fakeContext, serviceInfoJson } from '../tests/fake-server.js'
import { createArgs, ensureServiceProperties } from './service-properties.js'
import { ensurePostgres } from './postgres.js'
import { ensureRedis } from './redis.js'
import { maskSensitiveArgs } from '../core/mask.js'
import type { Config } from '../core/schema.js'

describe('createArgs', () => {
  it('turns every managed key into its create flag, in declared order, and each mount into --volume', () => {
    expect(createArgs({
      properties: {
        memory: 512, 'restart-policy': 'unless-stopped', 'post-create-network': ['a', 'b'], 'custom-env': { TZ: 'UTC' },
        password: 'hunter2', 'wait-timeout': 90, 'shm-size': '256m', 'config-options': '-c x=1',
        'log-driver': 'json-file', 'log-opt': ['max-size=10m'], 'initial-network': 'n', 'post-start-network': ['c'],
      },
    }, ['/srv/a:/opt/a', 'vol:/data:ro'])).toEqual([
      '--memory', '512', '--restart', 'unless-stopped', '--post-create-network', 'a,b', '--custom-env', 'TZ=UTC',
      '--password', 'hunter2', '--wait-timeout', '90', '--shm-size', '256m', '--config-options', '-c x=1',
      '--log-driver', 'json-file', '--log-opt', 'max-size=10m', '--initial-network', 'n', '--post-start-network', 'c',
      '--volume', '/srv/a:/opt/a', '--volume', 'vol:/data:ro',
    ])
  })

  it('gives volume-targets one --volume-target per volume, sorted', () => {
    expect(createArgs({ properties: { 'volume-targets': { data: '/var/lib/x', backups: '/srv/b' } } })).toEqual([
      '--volume-target', 'backups=/srv/b', '--volume-target', 'data=/var/lib/x',
    ])
  })

  it('leaves out keys with no built-in entry: they are set once the service exists', () => {
    expect(createArgs({ properties: { 'some-future-key': 'x' } })).toEqual([])
    expect(createArgs({})).toEqual([])
  })
})

describe.each([['postgres', ensurePostgres], ['redis', ensureRedis]] as const)('%s create', (plugin, ensure) => {
  it('creates a missing service with image, version, property flags and mounts on the :create line', async () => {
    const { ctx, runner } = fakeContext({ checks: { [`${plugin}:exists db`]: false }, queries: {} })
    const created = await ensure(ctx, { db: { version: '17', properties: { memory: 512, password: 'hunter2' }, mounts: ['a:/opt/a'] } } as any, { a: { path: '/srv/a' } } as any)
    expect([...created]).toEqual(['db'])
    expect(runner.dryRunLog).toEqual([
      `${plugin}:create db --image-version 17 --memory 512 --password hunter2 --volume /srv/a:/opt/a`,
    ])
  })

  it('the dry-run listing masks the password flag', async () => {
    const { ctx, runner } = fakeContext({ checks: { [`${plugin}:exists db`]: false }, queries: {} })
    await ensure(ctx, { db: { properties: { password: 'hunter2.zq7', 'custom-env': { TZ: 'UTC', API_KEY: 'zq7wxk9' } } } } as any)
    const shown = maskSensitiveArgs(runner.dryRunLog[0])
    expect(shown).toBe(`${plugin}:create db --password **** --custom-env TZ=****;API_KEY=****`)
  })

  it('a dry run of a new service also plans a key with no built-in entry as a :set after the :create', async () => {
    const { ctx } = fakeContext({ checks: {}, queries: {} })
    await ensureServiceProperties(ctx, plugin, { db: { properties: { memory: 512, 'some-future-key': 'x' } } }, { apps: {} } as Config, { dryRun: true, dryRunCreated: new Set(['db']) })
    expect(ctx.commands).toEqual([[`${plugin}:set`, 'db', 'some-future-key', '--', 'x']])
  })

  it('changes nothing about an existing service: its properties are reconciled by set, not create', async () => {
    const { ctx, runner } = fakeContext({
      checks: { [`${plugin}:exists db`]: true },
      queries: { [`${plugin}:info db --format json`]: serviceInfoJson('db', plugin, '17') },
    })
    await ensure(ctx, { db: { properties: { memory: 512 } } } as any)
    expect(runner.dryRunLog).toEqual([])
  })

  it('a service created in this run, read back with its flags, needs no set and no restart', async () => {
    const { ctx, runner } = fakeContext({
      checks: {},
      queries: { [`${plugin}:info db --format json`]: serviceInfoJson('db', plugin, '17', { memory: '512', 'post-create-network': 'a,b' }) },
    })
    const failed = await ensureServiceProperties(ctx, plugin, { db: { properties: { memory: 512, 'post-create-network': ['a', 'b'] } } }, { apps: {} } as Config)
    expect(failed).toEqual([])
    expect(runner.dryRunLog).toEqual([])
    expect(ctx.serviceRestarts.size).toBe(0)
  })
})
