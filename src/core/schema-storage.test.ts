import { describe, it, expect } from 'vitest'
import { parseConfig } from './schema.js'

describe('apps.<app>.storage: mounts', () => {
  const volumes = { uploads: {}, data: {}, media: { path: '/srv/media' } }
  const parse = (storage: unknown, v: unknown = volumes) => parseConfig({ apps: { myapp: { storage } }, volumes: v })
  const fails = (storage: unknown, v: unknown = volumes): string => {
    try { parse(storage, v) } catch (e) { return e instanceof Error ? e.message : String(e) }
    return ''
  }

  it('accepts the short form and the map form', () => {
    expect(parse([
      'uploads:/app/uploads',
      { entry: 'data', container_dir: '/app/data', readonly: true, phases: ['deploy'], options: ['Z', 'noexec'] },
      { entry: 'media', container_dir: '/app/media', process_type: 'worker' },
    ]).apps.myapp.storage).toHaveLength(3)
  })

  it('accepts an empty list', () => {
    expect(parse([]).apps.myapp.storage).toEqual([])
  })

  it('rejects a host path and points at volumes', () => {
    expect(fails(['/var/lib/dokku/data/storage/myapp/uploads:/app/uploads'])).toMatch(/host path.*volumes:.*path:/)
  })

  it('rejects an entry that is not declared', () => {
    expect(fails(['nope:/app/x'])).toContain("entry 'nope' is not declared under volumes:")
    expect(fails(['uploads:/app/x'], {})).toContain("entry 'uploads' is not declared under volumes:")
  })

  it('rejects subpath and volume_chown, which docker-local never applies', () => {
    expect(fails([{ entry: 'data', container_dir: '/d', subpath: 'x' }])).toContain('subpath is not supported')
    expect(fails([{ entry: 'data', container_dir: '/d', volume_chown: 'root' }])).toContain('volume_chown is not supported')
  })

  it('rejects a process_type of _default_', () => {
    expect(fails([{ entry: 'data', container_dir: '/d', process_type: '_default_' }])).toContain('leave process_type out')
  })

  it('rejects options Dokku would read as its own keys, or that duplicate readonly', () => {
    expect(fails([{ entry: 'data', container_dir: '/d', options: ['ro'] }])).toContain('use readonly')
    expect(fails([{ entry: 'data', container_dir: '/d', options: ['volume-subpath=x'] }])).toContain('must not contain')
    expect(fails([{ entry: 'data', container_dir: '/d', options: ['a,b'] }])).toContain('must not contain')
  })

  it('rejects a container dir used twice in one scope, or in the default scope and a named one', () => {
    expect(fails(['uploads:/app/x', 'data:/app/x'])).toContain("container_dir '/app/x' is mounted twice in every process")
    expect(fails(['uploads:/app/x', { entry: 'data', container_dir: '/app/x', process_type: 'web' }])).toContain('in the default scope and in a named process type')
  })

  it('allows one container dir in two named scopes', () => {
    expect(parse([
      { entry: 'uploads', container_dir: '/app/x', process_type: 'web' },
      { entry: 'data', container_dir: '/app/x', process_type: 'worker' },
    ]).apps.myapp.storage).toHaveLength(2)
  })

  it('rejects a relative container dir, and the short form with options', () => {
    expect(fails(['uploads:app/x'])).toContain('container_dir')
    expect(fails(['uploads:/app/x:ro'])).toContain('options need the map form')
  })

  it('allows a legacy- entry declared as {} to be mounted', () => {
    expect(parse(['legacy-3f9c1a2b7d:/app/x'], { 'legacy-3f9c1a2b7d': {} }).apps.myapp.storage).toHaveLength(1)
  })
})
