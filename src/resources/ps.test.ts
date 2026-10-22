import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { reconcile } from '../core/reconcile.js'
import { Scale, Ps, parseScale } from './ps.js'

function makeCtx(results: Record<string, string>) {
  const runner = createRunner({ dryRun: false })
  runner.query = vi.fn(async (...args: string[]) => results[args[0]] ?? '')
  runner.run = vi.fn()
  return createContext(runner)
}

const TABLE = `-----> Scaling for chatwoot
-----> proctype           qty
-----> --------           ---
-----> web                1
-----> worker             0
`

describe('parseScale (assumed ps:scale format)', () => {
  it('parses the table form', () => {
    expect(parseScale(TABLE)).toEqual({ web: '1', worker: '0' })
  })
  it('parses proc: count lines', () => {
    expect(parseScale('web: 2\nworker: 3\n')).toEqual({ web: '2', worker: '3' })
  })
  it('returns empty for empty output', () => {
    expect(parseScale('')).toEqual({})
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
    const ctx = makeCtx({ 'ps:scale': '' })
    await reconcile(Scale, ctx, 'new', { web: 1, worker: 1 } as any)
    expect(ctx.commands).toEqual([['ps:scale', '--skip-deploy', 'new', 'web=1', 'worker=1']])
  })
})

describe('Ps resource', () => {
  const report = '=====> myapp ps information\n       Deployed:                     true\n       Ps stop timeout seconds:      30\n       Computed stop timeout seconds: 30\n'

  it('sets a drifted property with ps:set', async () => {
    const ctx = makeCtx({ 'ps:report': report })
    await reconcile(Ps, ctx, 'myapp', { 'stop-timeout-seconds': 60 } as any)
    expect(ctx.commands).toEqual([['ps:set', 'myapp', 'stop-timeout-seconds', '60']])
  })

  it('is a no-op when the property matches', async () => {
    const ctx = makeCtx({ 'ps:report': report })
    await reconcile(Ps, ctx, 'myapp', { 'stop-timeout-seconds': 30 } as any)
    expect(ctx.commands).toEqual([])
  })
})
