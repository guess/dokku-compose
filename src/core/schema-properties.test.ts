import { describe, it, expect } from 'vitest'
import { parseConfig } from './schema.js'

const issues = (properties: unknown, plugin: 'postgres' | 'redis' = 'postgres') => {
  try { parseConfig({ apps: {}, [plugin]: { db: { properties } } }); return '' } catch (e: any) { return String(e.message) }
}
const mountIssues = (mounts: unknown, volumes: unknown = { data: {}, dumps: { path: '/srv/dumps' } }) => {
  try { parseConfig({ apps: {}, ...(volumes === null ? {} : { volumes }), postgres: { db: { mounts } } }); return '' } catch (e: any) { return String(e.message) }
}

describe('service properties', () => {
  it('accepts every managed key on postgres and redis', () => {
    const props = {
      memory: 512, 'shm-size': '256m', 'restart-policy': 'unless-stopped', 'log-driver': 'json-file',
      'log-opt': ['max-size=10m', 'max-file=3'], 'wait-timeout': 120, 'initial-network': 'myapp-net',
      'post-create-network': ['myapp-net', 'other-net'], 'post-start-network': 'myapp-net',
      'config-options': '-c max_connections=200', 'custom-env': { TZ: 'UTC', N: 1, ON: true }, password: 'hunter2.ok_~-',
      'volume-targets': { data: '/var/lib/data', backups: '/srv/backups/' },
    }
    expect(issues(props)).toBe('')
    expect(issues(props, 'redis')).toBe('')
  })

  it('passes keys it has no entry for through', () => {
    expect(issues({ 'some-future-key': 'x', 'another': 3 })).toBe('')
  })

  it('rejects keys another block owns, and keys that do not exist or are not worth managing', () => {
    expect(issues({ 'backup-bucket': 'b' })).toContain('backup:')
    expect(issues({ 'expose-mode': 'direct' })).toContain('not managed yet')
    expect(issues({ 'port-bind-address': '127.0.0.1' })).toContain('not managed yet')
    expect(issues({ 'port-source-range': '10.0.0.0/8' })).toContain('not managed yet')
    expect(issues({ 'root-password': 'x' })).toContain('no root password')
    expect(issues({ 'service-memory': 64 }, 'redis')).toContain('no service memory')
    expect(issues({ 'export-args': '--x' })).toContain('not managed')
    expect(issues({ mounts: '/a:/b' })).toContain('mounts:')
    expect(issues({ version: '17' })).toContain('beside `properties`')
    expect(issues({ image: 'postgres' })).toContain('beside `properties`')
  })

  it('checks custom-env: names, no ; or newline in a value, no placeholder, no list', () => {
    expect(issues({ 'custom-env': { 'BAD NAME': 'x' } })).toContain('not an environment variable name')
    expect(issues({ 'custom-env': { A: 'x;y' } })).toContain("must not contain ';'")
    expect(issues({ 'custom-env': { A: 'x\ny' } })).toContain("must not contain ';'")
    expect(issues({ 'custom-env': { TOKEN: 'REPLACE_ME' } })).toContain('REPLACE_ME')
    expect(issues({ 'custom-env': ['A=1'] })).toContain('map')
    expect(issues({ 'custom-env': 'A=1;B=2' })).toBe('')
  })

  it('checks volume-targets: absolute paths without colon, comma or space, not /, one entry per volume', () => {
    expect(issues({ 'volume-targets': 'a=/x b=/y' })).toBe('')
    expect(issues({ 'volume-targets': { a: 'relative' } })).toContain('absolute')
    expect(issues({ 'volume-targets': { a: '/x:ro' } })).toContain('colon')
    expect(issues({ 'volume-targets': { a: '/' } })).toContain('at /')
    expect(issues({ 'volume-targets': { a: '/x/..' } })).toContain('at /')
    expect(issues({ 'volume-targets': { a: '/srv/b/' } })).toBe('')
    expect(issues({ 'volume-targets': 'a=/x a=/y' })).toContain('more than once')
    expect(issues({ 'volume-targets': 'a' })).toContain('container path')
    expect(issues({ 'volume-targets': ['a=/x'] })).toContain('map')
  })

  it('checks the password: allowed characters, not empty, not the placeholder', () => {
    expect(issues({ password: 'has space' })).toContain('may hold only')
    expect(issues({ password: 'a$b' })).toContain('may hold only')
    expect(issues({ password: '' })).toContain('leave the key out')
    expect(issues({ password: 'REPLACE_ME' })).toContain('replace the REPLACE_ME placeholder written by export')
  })

  it('checks single lines, numbers and lists', () => {
    expect(issues({ 'config-options': 'a\nb' })).toContain('single line')
    expect(issues({ memory: 'lots' })).toContain('whole number')
    expect(issues({ memory: 0 })).toBe('')
    expect(issues({ 'wait-timeout': 0 })).toContain('greater than 0')
    expect(issues({ 'post-create-network': ['a b'] })).toContain('commas or spaces')
    expect(issues({ 'log-opt': { a: 'b' } })).toContain('takes a list')
    expect(issues({ 'restart-policy': ['a'] })).toContain('string or number')
  })
})

describe('service mounts', () => {
  it('takes entries of volumes: in the short form and the long form, an empty list, and nothing', () => {
    expect(mountIssues(['data:/opt/extra', { entry: 'dumps', container_dir: '/opt/dumps', readonly: true, options: ['z'] }])).toBe('')
    expect(mountIssues([])).toBe('')
    expect(mountIssues(undefined)).toBe('')
  })

  it('rejects a host path with a hint, packed options, an undeclared entry and no volumes: at all', () => {
    expect(mountIssues(['/srv/dumps:/opt/dumps'])).toContain('declare the directory as an entry under volumes:')
    expect(mountIssues(['data:/opt/extra:ro'])).toContain('options need the map form')
    expect(mountIssues(['nope:/opt/extra'])).toContain("entry 'nope' is not declared under volumes:")
    expect(mountIssues([{ entry: 'nope', container_dir: '/x' }])).toContain("entry 'nope' is not declared")
    expect(mountIssues(['data:/opt/extra'], null)).toContain('not declared')
  })

  it('rejects a bad container dir, a dir used twice, bad options and keys a service mount does not have', () => {
    expect(mountIssues(['data:relative'])).toContain('container_dir')
    expect(mountIssues(['data:/opt/x/'])).toContain('normalised')
    expect(mountIssues(['data:/opt/x', 'dumps:/opt/x'])).toContain('mounted twice')
    expect(mountIssues([{ entry: 'data', container_dir: '/x', options: ['ro'] }])).toContain("use readonly")
    expect(mountIssues([{ entry: 'data', container_dir: '/x', phases: ['deploy'] }])).not.toBe('')
    expect(mountIssues([{ entry: 'data', container_dir: '/x', process_type: 'web' }])).not.toBe('')
    expect(mountIssues('data:/opt/extra')).not.toBe('')
  })
})
