import { describe, it, expect } from 'vitest'
import { sanitizeName, legacyExportNames, type ServerEntry } from './volumes.js'

const legacy = (name: string, host_path: string): ServerEntry => ({ name, scheduler: 'docker-local', host_path })
const names = (entries: ServerEntry[], taken: string[] = []) =>
  Object.fromEntries(legacyExportNames(entries, new Set([...entries.map(e => e.name), ...taken])))

describe('sanitizeName', () => {
  it.each([
    ['uploads', 'uploads'],
    ['My Uploads', 'my-uploads'],
    ['--a__b--', 'a-b'],
    ['legacy-data', 'data'],
    ['legacy-legacy-data', 'data'],
    ['legacy-', 'legacy'],
    ['___', ''],
    ['', ''],
    ['x'.repeat(50), 'x'.repeat(45)],
    [`${'x'.repeat(44)}-yyy`, 'x'.repeat(44)],
  ])('%j -> %j', (raw, expected) => {
    expect(sanitizeName(raw)).toBe(expected)
  })
})

describe('legacyExportNames', () => {
  it('uses the last path component', () => {
    expect(names([legacy('legacy-a', '/var/lib/dokku/data/storage/myapp/uploads')])).toEqual({ 'legacy-a': 'uploads' })
  })

  it('falls back to the last two components when the name is taken', () => {
    expect(names([legacy('legacy-a', '/srv/myapp/uploads')], ['uploads'])).toEqual({ 'legacy-a': 'myapp-uploads' })
  })

  it('numbers a name when both candidates are taken', () => {
    expect(names([legacy('legacy-a', '/srv/myapp/uploads')], ['uploads', 'myapp-uploads'])).toEqual({ 'legacy-a': 'uploads-2' })
    expect(names([legacy('legacy-a', '/srv/myapp/uploads')], ['uploads', 'myapp-uploads', 'uploads-2'])).toEqual({ 'legacy-a': 'uploads-3' })
  })

  it('does not hand a name out twice in one export', () => {
    expect(names([legacy('legacy-a', '/srv/a/data'), legacy('legacy-b', '/srv/b/data')])).toEqual({
      'legacy-a': 'data',
      'legacy-b': 'b-data',
    })
  })

  it('strips the reserved prefix', () => {
    expect(names([legacy('legacy-a', '/srv/legacy-files')])).toEqual({ 'legacy-a': 'files' })
  })

  it('cuts a long name to 45 characters without a trailing dash', () => {
    const long = `${'x'.repeat(44)}-tail`
    const result = names([legacy('legacy-a', `/srv/${long}`)])['legacy-a']
    expect(result).toBe('x'.repeat(44))
  })

  it('keeps the numbered name within 45 characters', () => {
    const base = 'x'.repeat(45)
    const result = names([legacy('legacy-a', `/srv/${base}`)], [base, `srv-${base}`.slice(0, 45)])['legacy-a']
    expect(result).toHaveLength(45)
    expect(result).toMatch(/-2$/)
  })

  it('names a Docker volume after its name', () => {
    expect(names([legacy('legacy-a', 'My.Volume_1')])).toEqual({ 'legacy-a': 'my-volume-1' })
  })

  it('has no name for a path without a usable component', () => {
    expect(names([legacy('legacy-a', '/'), legacy('legacy-b', '/___'), legacy('legacy-c', '')])).toEqual({
      'legacy-a': null, 'legacy-b': null, 'legacy-c': null,
    })
  })

  it('is stable: entries are named in order of their legacy name', () => {
    const a = legacy('legacy-a', '/srv/x/data')
    const b = legacy('legacy-b', '/srv/y/data')
    expect(names([b, a])).toEqual({ 'legacy-a': 'data', 'legacy-b': 'y-data' })
  })
})
