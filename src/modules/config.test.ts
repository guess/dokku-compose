import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { exportAppConfig, ensureGlobalConfig, readGlobalEnvDrift } from './config.js'

describe('exportAppConfig', () => {
  it('returns parsed env vars excluding managed keys var', async () => {
    const runner = createRunner({ dryRun: false })
    runner.queryStrict = vi.fn().mockResolvedValue(
      '{"SECRET_KEY":"abc","PORT":"3000","DOKKU_COMPOSE_MANAGED_KEYS":"SECRET_KEY,PORT"}'
    )
    const ctx = createContext(runner)
    const result = await exportAppConfig(ctx, 'myapp')
    expect(result).toEqual({ SECRET_KEY: 'abc', PORT: '3000' })
  })

  it('returns undefined when no config', async () => {
    const runner = createRunner({ dryRun: false })
    runner.queryStrict = vi.fn().mockResolvedValue('{}')
    const ctx = createContext(runner)
    const result = await exportAppConfig(ctx, 'myapp')
    expect(result).toBeUndefined()
  })

  it('throws on non-JSON output (e.g. the one-line shell format)', async () => {
    const runner = createRunner({ dryRun: false })
    runner.queryStrict = vi.fn().mockResolvedValue("A='1' B='2'")
    await expect(exportAppConfig(createContext(runner), 'myapp')).rejects.toThrow(/did not return JSON/)
  })
})

function globalServer(env: Record<string, string>) {
  const runner = createRunner({ dryRun: true })
  runner.queryStrict = vi.fn(async (...args: string[]) => {
    if (args.join(' ') === 'config:export --global --format json') return JSON.stringify(env)
    throw new Error(`unexpected read ${args.join(' ')}`)
  })
  return { ctx: createContext(runner), runner }
}

describe('ensureGlobalConfig', () => {
  const M = 'DOKKU_COMPOSE_GLOBAL_MANAGED_KEYS'

  it('adds a key and writes the marker', async () => {
    const { ctx, runner } = globalServer({ A: '1', [M]: 'A' })
    await ensureGlobalConfig(ctx, { A: '1', B: 2 })
    expect(runner.dryRunLog).toEqual([`config:set --global B=2 ${M}=A,B`])
  })

  it('sets only a changed key', async () => {
    const { ctx, runner } = globalServer({ A: '1', B: 'old', [M]: 'A,B' })
    await ensureGlobalConfig(ctx, { A: '1', B: 'new' })
    expect(runner.dryRunLog).toEqual(['config:set --global B=new'])
  })

  it('runs nothing when every key and the marker match', async () => {
    const { ctx, runner } = globalServer({ A: '1', B: 'true', [M]: 'A,B' })
    await ensureGlobalConfig(ctx, { A: 1, B: true })
    expect(runner.dryRunLog).toEqual([])
  })

  it('unsets a marked key removed from the file, and nothing else', async () => {
    const { ctx, runner } = globalServer({
      A: '1', B: '2', HAND_SET: 'x', DOKKU_COMPOSE_BACKUP_HASH_MYAPP_DB: 'abc', [M]: 'A,B',
    })
    await ensureGlobalConfig(ctx, { A: '1' })
    expect(runner.dryRunLog).toEqual(['config:unset --global B', `config:set --global ${M}=A`])
  })

  it('an empty env: unsets every marked key and drops the marker', async () => {
    const { ctx, runner } = globalServer({ A: '1', HAND_SET: 'x', [M]: 'A' })
    await ensureGlobalConfig(ctx, {})
    expect(runner.dryRunLog).toEqual([`config:unset --global A ${M}`])
  })

  it('a box with no marker unsets nothing on its first run', async () => {
    const { ctx, runner } = globalServer({ A: '1', OLD: 'x' })
    await ensureGlobalConfig(ctx, { A: '1' })
    expect(runner.dryRunLog).toEqual([`config:set --global ${M}=A`])
  })

  it('never unsets a reserved name a marker lists', async () => {
    const { ctx, runner } = globalServer({ A: '1', [M]: `A,${M},DOKKU_COMPOSE_MANAGED_KEYS,DOKKU_COMPOSE_BACKUP_HASH_X` })
    await ensureGlobalConfig(ctx, { A: '1' })
    expect(runner.dryRunLog).toEqual([`config:set --global ${M}=A`])
  })

  it('a removed env: block unsets every marked key and drops the marker', async () => {
    const { ctx, runner } = globalServer({ A: '1', HAND_SET: 'x', [M]: 'A' })
    expect(await ensureGlobalConfig(ctx, undefined)).toBe(true)
    expect(runner.dryRunLog).toEqual([`config:unset --global A ${M}`])
  })

  it('no env: block and no marker does nothing', async () => {
    const { ctx, runner } = globalServer({ HAND_SET: 'x' })
    expect(await ensureGlobalConfig(ctx, undefined)).toBe(false)
    expect(runner.dryRunLog).toEqual([])
  })

  it('reports a change only when a user key was set or unset', async () => {
    expect(await ensureGlobalConfig(globalServer({ A: '1', [M]: 'A' }).ctx, { A: '1' })).toBe(false)
    expect(await ensureGlobalConfig(globalServer({ A: '1' }).ctx, { A: '1' })).toBe(false)
    expect(await ensureGlobalConfig(globalServer({ A: '1', [M]: 'A' }).ctx, { A: '2' })).toBe(true)
  })

  it('env: false leaves global env alone', async () => {
    const { ctx, runner } = globalServer({ A: '1', [M]: 'A' })
    await ensureGlobalConfig(ctx, false)
    expect(runner.dryRunLog).toEqual([])
  })
})

describe('readGlobalEnvDrift', () => {
  it('masks every value and never lists the marker as a user key', async () => {
    const { ctx } = globalServer({ A: 'plain-old', B: 'same', GONE: 'secret-value', [M_]: 'A,B,GONE' })
    const drift = await readGlobalEnvDrift(ctx, { A: 'plain-new', B: 'same' })
    expect(drift).toEqual({ changed: ['A'], removed: ['GONE'], markerOutdated: true })
    expect(JSON.stringify(drift)).not.toContain(M_)
  })

  it('a removed env: block shows the marked keys as removed', async () => {
    const { ctx } = globalServer({ A: '1', [M_]: 'A' })
    expect(await readGlobalEnvDrift(ctx, undefined)).toEqual({ changed: [], removed: ['A'], markerOutdated: true })
  })

  it('is empty when in sync', async () => {
    const { ctx } = globalServer({ A: '1', [M_]: 'A' })
    expect(await readGlobalEnvDrift(ctx, { A: '1' })).toEqual({ changed: [], removed: [], markerOutdated: false })
  })
})
const M_ = 'DOKKU_COMPOSE_GLOBAL_MANAGED_KEYS'
