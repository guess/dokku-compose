import { describe, it, expect } from 'vitest'
import {
  defaultPath, entryNameError, isNormalizedAbsolute, pathError, chownError, modeError, normalizeMode,
  usesDefaultLocation, parseMountString, mountIssues, normalizeMount, scopesOverlap, declaredMounts,
} from './volume-rules.js'

describe('entry names', () => {
  it.each(['uploads', 'a', 'my-data-2', 'a'.repeat(45)])('accepts %s', n => {
    expect(entryNameError(n)).toBeUndefined()
  })
  it.each(['Uploads', '-x', 'x-', 'my_data', '', 'a'.repeat(46), 'a b'])('rejects %j', n => {
    expect(entryNameError(n)).toMatch(/not a valid entry name/)
  })
})

describe('paths', () => {
  it.each(['/srv/media', '/a', 'my-volume', 'vol.2_x'])('accepts %s', p => {
    expect(pathError(p)).toBeUndefined()
  })
  it.each(['/', '/srv/', '/srv//media', '/srv/./media', '/srv/../media', 'rel/path', 'x', ''])('rejects %j', p => {
    expect(pathError(p)).toBeDefined()
  })
  it('knows a normalised absolute path', () => {
    expect(isNormalizedAbsolute('/a/b')).toBe(true)
    expect(isNormalizedAbsolute('/a/b/')).toBe(false)
  })
  it('treats the default location as no path', () => {
    expect(usesDefaultLocation('uploads', undefined)).toBe(true)
    expect(usesDefaultLocation('uploads', defaultPath('uploads'))).toBe(true)
    expect(usesDefaultLocation('uploads', '/var/lib/dokku/data/storage/other')).toBe(false)
    expect(usesDefaultLocation('uploads', 'a-volume')).toBe(false)
  })
})

describe('chown and mode', () => {
  it.each(['herokuish', 'heroku', 'paketo', 'root', '0', '1000', '65535', 0, 32767, 65535, false])('chown accepts %j', v => {
    expect(chownError(v)).toBeUndefined()
  })
  it.each(['65536', 65536, -1, 1.5, 'www', true, '', '10x'])('chown rejects %j', v => {
    expect(chownError(v)).toBeDefined()
  })
  it.each(['750', '0750', '0777'])('mode accepts %s', v => {
    expect(modeError(v)).toBeUndefined()
  })
  it('mode rejects a YAML number with a hint to quote it', () => {
    expect(modeError(750)).toMatch(/quoted octal string/)
    expect(modeError(488)).toMatch(/mode: "0488"/)
  })
  it.each(['78', '07500', 'rwx', ''])('mode rejects %j', v => {
    expect(modeError(v)).toBeDefined()
  })
  it('normalises a 3 digit mode', () => {
    expect(normalizeMode('750')).toBe('0750')
    expect(normalizeMode('0750')).toBe('0750')
  })
})

describe('mounts', () => {
  it('parses entry:dir', () => {
    expect(parseMountString('uploads:/app/uploads')).toEqual({ entry: 'uploads', container_dir: '/app/uploads' })
  })
  it('points a host path at volumes', () => {
    expect(parseMountString('/var/lib/dokku/data/storage/x:/app/x')).toMatch(/host path.*volumes:.*path:/)
  })
  it.each(['uploads', 'uploads:/a:ro', ':/a', 'uploads:'])('rejects the short form %j', s => {
    expect(typeof parseMountString(s)).toBe('string')
  })

  it('accepts a plain mount', () => {
    expect(mountIssues({ entry: 'u', container_dir: '/app/u' })).toEqual([])
  })
  it.each([
    [{ container_dir: 'app/u' }, /container_dir/],
    [{ container_dir: '/app/u/' }, /container_dir/],
    [{ container_dir: '/app:u' }, /container_dir/],
    [{ process_type: '_default_' }, /leave process_type out/],
    [{ process_type: 'web worker' }, /Procfile process type/],
    [{ options: ['ro'] }, /use readonly/],
    [{ options: ['rw'] }, /use readonly/],
    [{ options: ['a,b'] }, /must not contain/],
    [{ options: ['volume-subpath=x'] }, /must not contain/],
    [{ options: [''] }, /empty/],
    [{ phases: ['deploy', 'deploy'] as ('deploy' | 'run')[] }, /repeat/],
  ])('rejects %j', (extra, message) => {
    expect(mountIssues({ entry: 'u', container_dir: '/app/u', ...extra }).join('\n')).toMatch(message)
  })

  it('fills in the defaults', () => {
    expect(normalizeMount({ entry: 'u', container_dir: '/app/u' })).toEqual({
      entry: 'u', container_dir: '/app/u', readonly: false, phases: ['deploy', 'run'], process_type: '_default_', options: [],
    })
    expect(normalizeMount({ entry: 'u', container_dir: '/a', phases: ['run', 'deploy'], process_type: 'worker', readonly: true, options: ['Z'] }))
      .toMatchObject({ phases: ['deploy', 'run'], process_type: 'worker', readonly: true, options: ['Z'] })
  })

  it('reads both forms of an app list and skips what does not parse', () => {
    expect(declaredMounts(['a:/x', { entry: 'b', container_dir: '/y' }, '/bad:/z']).map(m => m.entry)).toEqual(['a', 'b'])
  })

  it('knows which scopes overlap', () => {
    expect(scopesOverlap('_default_', 'web')).toBe(true)
    expect(scopesOverlap('web', 'web')).toBe(true)
    expect(scopesOverlap('web', 'worker')).toBe(false)
  })
})
