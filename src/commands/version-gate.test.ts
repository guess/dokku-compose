import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { runUp } from './up.js'
import { runDown } from './down.js'
import { runExport } from './export.js'
import { runPs } from './ps.js'
import { computeDiff, formatSummary, formatVerbose } from './diff.js'
import type { Config } from '../core/schema.js'

function fakeServer(version: string) {
  const runner = createRunner({ dryRun: false })
  const other: string[] = []
  runner.query = vi.fn(async (...a: string[]) => {
    if (a[0] === 'version') return `dokku version ${version}`
    other.push(a.join(' '))
    return ''
  })
  runner.queryStrict = vi.fn(async (...a: string[]) => {
    other.push(a.join(' '))
    if (a.join(' ') === 'config:export --global --format json') return '{}'
    return a[0] === 'plugin:list' ? '[]' : ''
  })
  runner.check = vi.fn(async (...a: string[]) => {
    other.push(a.join(' '))
    return a[0] === 'apps:exists'
  })
  runner.run = vi.fn(async (...a: string[]) => {
    other.push(a.join(' '))
  })
  return { runner, ctx: createContext(runner), other }
}

const config = (version?: string): Config => ({
  ...(version ? { dokku: { version } } : {}),
  apps: { web: { ports: ['http:80:5000'] } },
})

const TOO_OLD = /needs Dokku >= 0\.38\.32; this server runs 0\.37\.9\. Upgrade Dokku first\./

describe('built-in Dokku floor', () => {
  it('up stops before any other Dokku call', async () => {
    const { ctx, other } = fakeServer('0.37.9')
    await expect(runUp(ctx, config(), [])).rejects.toThrow(TOO_OLD)
    expect(other).toEqual([])
  })

  it('up --dry-run on an old server still stops before any other call', async () => {
    const { other } = fakeServer('0.37.9')
    const dry = createRunner({ dryRun: true })
    const seen: string[] = []
    dry.query = vi.fn(async (...a: string[]) => {
      if (a[0] === 'version') return 'dokku version 0.37.9'
      seen.push(a.join(' '))
      return ''
    })
    dry.queryStrict = vi.fn(async (...a: string[]) => { seen.push(a.join(' ')); return '' })
    dry.check = vi.fn(async (...a: string[]) => { seen.push(a.join(' ')); return false })
    await expect(runUp(createContext(dry), config(), [])).rejects.toThrow(TOO_OLD)
    expect(seen).toEqual([])
    expect(dry.dryRunLog).toEqual([])
    expect(other).toEqual([])
  })

  it('0.38.32 passes the floor', async () => {
    const { ctx } = fakeServer('0.38.32')
    await expect(computeDiff(ctx, config())).resolves.toBeDefined()
  })

  it('0.38.31 fails the floor', async () => {
    const { ctx, other } = fakeServer('0.38.31')
    await expect(computeDiff(ctx, config())).rejects.toThrow(/this server runs 0\.38\.31/)
    expect(other).toEqual([])
  })

  it('diff stops before any other Dokku call', async () => {
    const { ctx, other } = fakeServer('0.37.9')
    await expect(computeDiff(ctx, config())).rejects.toThrow(TOO_OLD)
    expect(other).toEqual([])
  })

  it('down stops before any other Dokku call', async () => {
    const { ctx, other } = fakeServer('0.37.9')
    await expect(runDown(ctx, config(), [], { force: true })).rejects.toThrow(TOO_OLD)
    expect(other).toEqual([])
  })

  it('export stops before any other Dokku call', async () => {
    const { ctx, other } = fakeServer('0.37.9')
    await expect(runExport(ctx, {})).rejects.toThrow(TOO_OLD)
    expect(other).toEqual([])
  })

  it('ps stops before any other Dokku call', async () => {
    const { runner, other } = fakeServer('0.37.9')
    await expect(runPs(runner, config(), [])).rejects.toThrow(TOO_OLD)
    expect(other).toEqual([])
  })
})

describe('dokku.version in the file', () => {
  it('up stops before changing anything when the server is older than the file', async () => {
    const { ctx, other } = fakeServer('0.38.32')
    await expect(runUp(ctx, config('0.38.33'), [])).rejects.toThrow(
      /server is v0\.38\.32 but the file requires >= v0\.38\.33/
    )
    expect(other).toEqual([])
    expect(ctx.runner.run).not.toHaveBeenCalled()
  })

  it('diff reports an older server as drift, not an error', async () => {
    const { ctx } = fakeServer('0.38.32')
    const diff = await computeDiff(ctx, config('0.38.33'))
    expect(diff.inSync).toBe(false)
    expect(formatSummary(diff)).toContain('version: 0.38.33 (file) → 0.38.32 (server)')
  })

  it('diff reports a newer server as drift and does not throw', async () => {
    const { ctx } = fakeServer('0.38.34')
    const diff = await computeDiff(ctx, config('0.38.33'))
    expect(diff.inSync).toBe(false)
    expect(formatSummary(diff)).toContain('~') // marker
    expect(formatSummary(diff)).toContain('version: 0.38.33 (file) → 0.38.34 (server)')
    expect(formatVerbose(diff)).toContain('@@ dokku version @@')
  })

  it('diff is silent when the versions are equal', async () => {
    const { ctx } = fakeServer('0.38.33')
    const diff = await computeDiff(ctx, config('0.38.33'))
    expect(diff.dokku).toBeUndefined()
    expect(formatSummary(diff)).not.toContain('dokku')
  })

  it('diff has no version line when the file declares none', async () => {
    const { ctx } = fakeServer('0.38.34')
    const diff = await computeDiff(ctx, config())
    expect(diff.dokku).toBeUndefined()
  })

  it('up logs one notice for a newer server and carries on', async () => {
    const { ctx, runner } = fakeServer('0.38.34')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await runUp(ctx, config('0.38.33'), [])
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(runner.run).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('up is silent when equal', async () => {
    const { ctx } = fakeServer('0.38.33')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await runUp(ctx, config('0.38.33'), [])
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('unparseable `dokku version` still throws', async () => {
    const { runner, ctx } = fakeServer('0.38.33')
    runner.query = vi.fn(async () => 'something weird')
    await expect(computeDiff(ctx, config('0.38.33'))).rejects.toThrow(/parse/i)
  })
})
