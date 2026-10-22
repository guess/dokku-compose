import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { reconcile } from '../core/reconcile.js'
import { Scale, Ps, parseScale } from './ps.js'
import { computeAdditiveChange } from '../core/change.js'

function makeCtx(results: Record<string, string>) {
  const runner = createRunner({ dryRun: false })
  runner.query = vi.fn(async (...args: string[]) => results[args[0]] ?? '')
  runner.run = vi.fn()
  return createContext(runner)
}

const TABLE = JSON.stringify([
  { process_type: 'release', quantity: 0 },
  { process_type: 'web', quantity: 1 },
  { process_type: 'worker', quantity: 0 },
])

describe('parseScale', () => {
  it('parses ps:scale --format json', () => {
    expect(parseScale(TABLE)).toEqual({ release: '0', web: '1', worker: '0' })
  })
  it('returns empty for empty or invalid output', () => {
    expect(parseScale('')).toEqual({})
    expect(parseScale('not json')).toEqual({})
  })
})

describe('Scale resource', () => {
  it('applies a drifted scale with --skip-deploy in one command', async () => {
    const ctx = makeCtx({ 'ps:scale': TABLE })
    await reconcile(Scale, ctx, 'chatwoot', { web: 1, worker: 1 } as any)
    expect(ctx.commands).toEqual([['ps:scale', '--skip-deploy', 'chatwoot', 'worker=1']])
  })

  it('is a no-op when the scale already matches', async () => {
    const ctx = makeCtx({ 'ps:scale': TABLE })
    await reconcile(Scale, ctx, 'chatwoot', { web: 1, worker: 0 } as any)
    expect(ctx.commands).toEqual([])
  })

  it('leaves a process type removed from the file alone', async () => {
    const ctx = makeCtx({ 'ps:scale': TABLE })
    await reconcile(Scale, ctx, 'chatwoot', { web: 1 } as any)
    expect(ctx.commands).toEqual([])
  })

  it('applies the scale to a never-deployed app with no scale output', async () => {
    const ctx = makeCtx({ 'ps:scale': '[]' })
    await reconcile(Scale, ctx, 'new', { web: 1, worker: 1 } as any)
    expect(ctx.commands).toEqual([['ps:scale', '--skip-deploy', 'new', 'web=1', 'worker=1']])
  })
})

describe('Ps resource', () => {
  const report = JSON.stringify({
    deployed: 'true', 'restart-policy': 'on-failure:10', 'stop-timeout-seconds': '30',
    'procfile-path': '', 'computed-stop-timeout-seconds': '30', 'status-web-1': 'running',
  })

  it('reads only settable, non-empty keys', async () => {
    const ctx = makeCtx({ 'ps:report': report })
    expect(await Ps.read(ctx, 'myapp')).toEqual({ 'restart-policy': 'on-failure:10', 'stop-timeout-seconds': '30' })
  })

  it('sets a drifted property with ps:set', async () => {
    const ctx = makeCtx({ 'ps:report': report })
    await reconcile(Ps, ctx, 'myapp', { 'stop-timeout-seconds': 60 })
    expect(ctx.commands).toEqual([['ps:set', 'myapp', 'stop-timeout-seconds', '60']])
  })

  it('is a no-op when the properties match', async () => {
    const ctx = makeCtx({ 'ps:report': report })
    await reconcile(Ps, ctx, 'myapp', { 'restart-policy': 'on-failure:10', 'stop-timeout-seconds': 30 })
    expect(ctx.commands).toEqual([])
  })
})

describe('Ps resource, hand-set key absent from the file', () => {
  it('is no change and diff reports in sync', async () => {
    const report = JSON.stringify({ 'restart-policy': 'always', 'stop-timeout-seconds': '30' })
    const ctx = makeCtx({ 'ps:report': report })
    await reconcile(Ps, ctx, 'myapp', { 'stop-timeout-seconds': 30 })
    expect(ctx.commands).toEqual([])
    expect(computeAdditiveChange(await Ps.read(ctx, 'myapp'), { 'stop-timeout-seconds': 30 }).changed).toBe(false)
  })
})

describe('additive change with unreadable current state', () => {
  it('an undefined current state is drift, not in sync', () => {
    expect(computeAdditiveChange(undefined, { web: 1 }).changed).toBe(true)
    expect(computeAdditiveChange(null, { web: 1 }).changed).toBe(true)
  })
  it('keys only on the server are not drift', () => {
    expect(computeAdditiveChange({ web: '1', release: '0' }, { web: 1 }).changed).toBe(false)
  })
})
