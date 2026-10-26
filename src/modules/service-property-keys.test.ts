// The built-in table is pinned to the settable keys and create flags dokku-postgres and
// dokku-redis 2.4.0 list (fixtures/datastore-2.4.0, taken from each readme), the way
// property-keys.test.ts pins the Dokku namespaces: a key added or dropped by a plugin
// upgrade, or a table entry that names no real key or flag, fails here.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  MANAGED_PROPERTIES, PLUGIN_SET_KEYS, MANAGED_NOT_IN_TESTED_VERSION, targetPairs, rejectedReason, PRUNABLE_PROPERTIES, propertyString, sameProperty,
  isDefaultProperty, normalizeMount, parseInfoMounts, mountSet, type ServicePlugin,
} from './service-property-keys.js'

const fixture = (plugin: ServicePlugin): { set: string[]; create: string[] } =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/datastore-2.4.0/${plugin}.json`, import.meta.url), 'utf8'))

describe.each(['postgres', 'redis'] as const)('%s 2.4.0 settable keys', plugin => {
  const { set, create } = fixture(plugin)

  it('the known-key list equals the keys the plugin lists', () => {
    expect([...PLUGIN_SET_KEYS[plugin]].sort()).toEqual([...set].sort())
  })

  it('every key is managed, rejected with a reason, or unlisted on purpose (none is silently passed through)', () => {
    const plain = set.filter(k => !(k in MANAGED_PROPERTIES) && rejectedReason(k) === undefined)
    expect(plain).toEqual([])
  })

  it('every managed key is a key the plugin sets, and none is also rejected', () => {
    for (const key of Object.keys(MANAGED_PROPERTIES).filter(k => !MANAGED_NOT_IN_TESTED_VERSION.includes(k))) {
      expect(set).toContain(key)
    }
    for (const key of Object.keys(MANAGED_PROPERTIES)) expect(rejectedReason(key)).toBeUndefined()
  })

  it('the managed keys the plugin does not list are only those a datastore definition has to declare', () => {
    expect(MANAGED_NOT_IN_TESTED_VERSION).toEqual(['service-memory'])
    for (const key of MANAGED_NOT_IN_TESTED_VERSION) {
      expect(set).not.toContain(key)
      expect(MANAGED_PROPERTIES[key]).toBeDefined()
    }
  })

  it('every create flag in the table is a flag the plugin has', () => {
    for (const [key, spec] of Object.entries(MANAGED_PROPERTIES).filter(([k]) => !MANAGED_NOT_IN_TESTED_VERSION.includes(k))) {
      expect(create, `${key} -> --${spec.createFlag}`).toContain(spec.createFlag)
    }
  })

  it('rejected keys include everything another block owns', () => {
    for (const key of set.filter(k => /^(backup-|expose-)/.test(k) || ['port-bind-address', 'port-source-range'].includes(k))) {
      expect(rejectedReason(key), key).toBeDefined()
    }
  })
})

describe('the table', () => {
  it('has no root-password: the plugins do not have one', () => {
    expect(MANAGED_PROPERTIES['root-password']).toBeUndefined()
    expect(rejectedReason('root-password')).toContain('no root password')
  })

  it('never prunes the password', () => {
    expect(PRUNABLE_PROPERTIES).not.toContain('password')
    expect(PRUNABLE_PROPERTIES).toContain('memory')
  })

  it('marks the stop-and-start keys', () => {
    const restart = Object.entries(MANAGED_PROPERTIES).filter(([, s]) => s.restart).map(([k]) => k).sort()
    expect(restart).toEqual(['config-options', 'custom-env', 'initial-network', 'log-driver', 'log-opt', 'memory', 'post-create-network', 'post-start-network', 'restart-policy', 'service-memory', 'shm-size', 'volume-targets'])
  })
})

describe('values', () => {
  it('writes lists with commas, maps with semicolons and numbers as decimals', () => {
    expect(propertyString('log-opt', ['max-size=10m', 'max-file=3'])).toBe('max-size=10m,max-file=3')
    expect(propertyString('custom-env', { TZ: 'UTC', A: 1 })).toBe('TZ=UTC;A=1')
    expect(propertyString('memory', 512)).toBe('512')
  })

  it('compares lists and custom-env as sets, memory 0 as unset, the rest exactly', () => {
    expect(sameProperty('post-create-network', 'a,b', 'b,a')).toBe(true)
    expect(sameProperty('log-opt', 'max-size=10m,max-file=3', 'max-file=3,max-size=10m')).toBe(true)
    expect(sameProperty('custom-env', 'B=2;A=1', 'A=1;B=2')).toBe(true)
    expect(sameProperty('custom-env', 'A=1', 'A=2')).toBe(false)
    expect(sameProperty('memory', '0', '')).toBe(true)
    expect(sameProperty('memory', '512', '0')).toBe(false)
    expect(sameProperty('shm-size', '256m', '256M')).toBe(false)
    expect(sameProperty('some-new-key', 'a,b', 'b,a')).toBe(false)
  })

  it('writes volume-targets sorted by volume with spaces, and compares them as a set', () => {
    expect(propertyString('volume-targets', { data: '/var/lib/x', backups: '/srv/b' })).toBe('backups=/srv/b data=/var/lib/x')
    expect(propertyString('volume-targets', 'data=/var/lib/x')).toBe('data=/var/lib/x')
    expect(sameProperty('volume-targets', 'b=/b a=/a', 'a=/a b=/b')).toBe(true)
    expect(sameProperty('volume-targets', 'a=/a', 'a=/other')).toBe(false)
    expect(targetPairs('b=/b a=/a')).toEqual([['a', '/a'], ['b', '/b']])
    expect(isDefaultProperty('service-memory', '')).toBe(true)
    expect(isDefaultProperty('volume-targets', 'a=/a')).toBe(false)
  })

  it('reads an unset key and memory 0 as the default', () => {
    expect(isDefaultProperty('memory', '0')).toBe(true)
    expect(isDefaultProperty('memory', '')).toBe(true)
    expect(isDefaultProperty('memory', '512')).toBe(false)
    expect(isDefaultProperty('restart-policy', '')).toBe(true)
    expect(isDefaultProperty('restart-policy', 'always')).toBe(false)
  })
})

describe('mount specs', () => {
  it.each([
    ['/srv/a:/opt/a', '/srv/a:/opt/a'],
    ['/srv/a:/opt/a:', '/srv/a:/opt/a'],
    ['/srv/a:/opt/a:rw', '/srv/a:/opt/a'],
    ['vol:/data:ro', 'vol:/data:ro'],
    ['vol:/data:z,ro', 'vol:/data:ro,z'],
    ['vol:/data:volume-chown=heroku,volume-subpath=up,nocopy', 'vol:/data:nocopy,volume-subpath=up,volume-chown=heroku'],
    ['vol:/data:rw,ro,z', 'vol:/data:ro,z'],
  ])('%s is %s', (spec, expected) => {
    expect(normalizeMount(spec)).toBe(expected)
  })

  it('reads the space-joined mounts of info as a sorted set, ignoring order and duplicates', () => {
    expect(parseInfoMounts('/srv/b:/opt/b vol:/data:ro /srv/a:/opt/a')).toEqual(['/srv/a:/opt/a', '/srv/b:/opt/b', 'vol:/data:ro'])
    expect(parseInfoMounts('')).toEqual([])
    expect(mountSet(['vol:/data:ro', 'vol:/data:ro,rw'])).toEqual(['vol:/data:ro'])
  })
})
