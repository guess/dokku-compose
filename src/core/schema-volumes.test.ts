import { describe, it, expect } from 'vitest'
import { parseConfig } from './schema.js'

const msg = (volumes: unknown): string => {
  try { parseConfig({ apps: {}, volumes }) } catch (e) { return e instanceof Error ? e.message : String(e) }
  return ''
}
const ok = (volumes: unknown) => parseConfig({ apps: {}, volumes }).volumes

describe('volumes: entries', () => {
  it('accepts every form', () => {
    expect(ok({
      uploads: {},
      data: { chown: 1000, mode: '0750' },
      scratch: { chown: false },
      media: { path: '/srv/media' },
      named: { path: 'my-volume', chown: false },
      preset: { chown: 'paketo', mode: '750' },
      'legacy-3f9c1a2b7d': {},
    })).toBeDefined()
  })

  it('accepts a path equal to the default location with chown and mode', () => {
    expect(ok({ uploads: { path: '/var/lib/dokku/data/storage/uploads', chown: 'root', mode: '0700' } })).toBeDefined()
  })

  it('rejects an unknown key', () => {
    expect(msg({ uploads: { owner: 'x' } })).toContain('owner')
  })

  it.each(['Uploads', 'my_data', '-x', 'a'.repeat(46)])('rejects the name %s', name => {
    expect(msg({ [name]: {} })).toContain('not a valid entry name')
  })

  it('reserves legacy- except as {}', () => {
    expect(msg({ 'legacy-abc': { chown: 'root' } })).toContain("starts with 'legacy-'")
  })

  it('rejects a YAML number as mode and says to quote it', () => {
    expect(msg({ uploads: { mode: 750 } })).toContain('quoted octal string')
  })

  it.each([{ chown: true }, { chown: 70000 }, { chown: 'www-data' }, { chown: -1 }])('rejects %j', v => {
    expect(msg({ uploads: v })).toContain('chown')
  })

  it.each(['/srv/media/', '/srv//media', '/srv/../media', 'a/b', '/'])('rejects the path %s', path => {
    expect(msg({ uploads: { path } })).toContain('path')
  })

  it('rejects mode on a custom path', () => {
    expect(msg({ media: { path: '/srv/media', mode: '0750' } })).toContain('mode needs the default location')
  })

  it('rejects chown with a value on a custom path, but not chown: false', () => {
    expect(msg({ media: { path: '/srv/media', chown: 'herokuish' } })).toContain('chown needs the default location')
    expect(msg({ media: { path: 'a-volume', chown: 33 } })).toContain('chown needs the default location')
    expect(msg({ media: { path: '/srv/media', chown: false } })).toBe('')
  })
})
