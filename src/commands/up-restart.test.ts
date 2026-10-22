import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRunner, DokkuCommandError } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { reconcile } from '../core/reconcile.js'
import { runUp, UpFailedError } from './up.js'
import { emptyAnswer } from '../tests/fake-server.js'
import { Config as Env } from '../resources/config.js'
import { Storage, Ports, Domains } from '../resources/lists.js'
import { DockerOptions } from '../resources/docker-options.js'
import { Networks, NetworkProps } from '../resources/network.js'
import { Nginx } from '../resources/properties.js'
import { Proxy } from '../resources/toggle.js'
import { ensureAppLinks } from '../modules/links.js'
import type { Config } from '../core/schema.js'

function makeCtx(opts: { dryRun?: boolean } = {}) {
  const runner = createRunner({ dryRun: opts.dryRun ?? false })
  runner.check = vi.fn().mockResolvedValue(false)
  runner.query = vi.fn(async (...args: string[]) =>
    args[0] === 'version' ? 'dokku version 0.38.31' : (emptyAnswer(...args) ?? ''))
  runner.queryStrict = vi.fn(async (...args: string[]) => {
    const out = await runner.query(...args)
    return args[0] === 'plugin:list' && !out ? '[]' : out
  })
  runner.run = vi.fn()
  return { runner, ctx: createContext(runner) }
}

describe('restart record, per resource', () => {
  it('env set marks the app', async () => {
    const { ctx } = makeCtx()
    await reconcile(Env, ctx, 'myapp', { A: '1' })
    expect([...ctx.restarts]).toEqual([['myapp', ['env']]])
  })

  it('env unset marks the app', async () => {
    const { runner, ctx } = makeCtx()
    runner.query = vi.fn().mockResolvedValueOnce('OLD')
    runner.queryStrict = vi.fn().mockResolvedValueOnce('{"OLD":"x"}')
    await reconcile(Env, ctx, 'myapp', { NEW: '1' })
    expect(ctx.restarts.get('myapp')).toEqual(['env'])
  })

  it('storage mount and unmount mark the app', async () => {
    const { runner, ctx } = makeCtx()
    runner.query = vi.fn().mockResolvedValue('-v /a:/b')
    await reconcile(Storage, ctx, 'myapp', ['/c:/d'])
    expect(ctx.commands.map(c => c[0])).toEqual(['storage:unmount', 'storage:mount'])
    expect(ctx.restarts.get('myapp')).toEqual(['storage'])
  })

  it('deploy and run docker options mark the app', async () => {
    for (const phase of ['deploy', 'run'] as const) {
      const { ctx } = makeCtx()
      await reconcile(DockerOptions, ctx, 'myapp', { [phase]: ['--shm-size 256m'] })
      expect(ctx.restarts.get('myapp')).toEqual(['docker_options'])
    }
  })

  it('a build docker option does not mark the app (a restart does not rebuild)', async () => {
    const { ctx } = makeCtx()
    await reconcile(DockerOptions, ctx, 'myapp', { build: ['--network host'] })
    expect(ctx.commands.length).toBe(1)
    expect(ctx.restarts.size).toBe(0)
  })

  it('attach-post-deploy and network properties mark the app', async () => {
    const a = makeCtx()
    await reconcile(Networks, a.ctx, 'myapp', ['net1'])
    expect(a.ctx.restarts.get('myapp')).toEqual(['network'])
    const b = makeCtx()
    await reconcile(NetworkProps, b.ctx, 'myapp', { tld: 'internal' })
    expect(b.ctx.restarts.get('myapp')).toEqual(['network'])
  })

  it('link and unlink mark the app', async () => {
    const config = { apps: {}, postgres: { db: {} }, redis: { cache: {} } } as unknown as Config
    const { runner, ctx } = makeCtx()
    runner.check = vi.fn(async (...a: string[]) => a[0] === 'redis:linked')
    await ensureAppLinks(ctx, 'myapp', ['db'], config)
    expect(ctx.commands.map(c => c[0])).toEqual(['postgres:link', 'redis:unlink'])
    expect(ctx.restarts.get('myapp')).toEqual(['links'])
  })

  it('live changes (ports, domains, nginx, proxy) mark nothing', async () => {
    const { ctx } = makeCtx()
    await reconcile(Ports, ctx, 'myapp', ['http:80:5000'])
    await reconcile(Domains, ctx, 'myapp', ['a.example.com'])
    await reconcile(Nginx, ctx, 'myapp', { 'client-max-body-size': '15m' })
    await reconcile(Proxy, ctx, 'myapp', true)
    expect(ctx.commands.length).toBeGreaterThan(0)
    expect(ctx.restarts.size).toBe(0)
  })
})

describe('runUp restart summary', () => {
  afterEach(() => vi.restoreAllMocks())

  function capture() {
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { lines.push(a.join(' ')) })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    return lines
  }
  const cfg = (apps: Record<string, object>, extra: object = {}) =>
    ({ apps, ...extra }) as unknown as Config

  it('lists each app with the exact restart command, and never runs one', async () => {
    const lines = capture()
    const { ctx } = makeCtx()
    await runUp(ctx, cfg({ a: { env: { X: '1' } }, b: { ports: ['http:80:5000'] } }), [])
    expect(lines).toContain('\n# Apps that need a restart:')
    expect(lines.filter(l => l.startsWith('dokku ps:restart'))).toEqual(['dokku ps:restart a  # env'])
    expect(ctx.commands.some(c => c[0] === 'ps:restart')).toBe(false)
  })

  it('a global env change lists every app in the file', async () => {
    const lines = capture()
    const { ctx } = makeCtx()
    await runUp(ctx, cfg({ a: {}, b: {} }, { env: { G: '1' } }), [])
    expect(lines.filter(l => l.startsWith('dokku ps:restart')))
      .toEqual(['dokku ps:restart a  # global env', 'dokku ps:restart b  # global env'])
  })

  it('a dry run says "would need"', async () => {
    const lines = capture()
    const { ctx } = makeCtx({ dryRun: true })
    await runUp(ctx, cfg({ a: { env: { X: '1' } } }), [], { dryRun: true })
    expect(lines).toContain('\n# Apps that would need a restart:')
  })

  it('prints nothing when no change needs a restart', async () => {
    const lines = capture()
    const { ctx } = makeCtx()
    await runUp(ctx, cfg({ a: { ports: ['http:80:5000'] } }), [])
    expect(lines.filter(l => /restart/.test(l))).toEqual([])
  })

  it('still prints after a partial failure', async () => {
    const lines = capture()
    const { runner, ctx } = makeCtx()
    runner.run = vi.fn(async (...args: string[]) => {
      if (args[0] === 'apps:create' && args[1] === 'bad') throw new DokkuCommandError(args, 1, 'boom')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(runUp(ctx, cfg({ good: { env: { X: '1' } }, bad: { env: { X: '1' } } }), []))
      .rejects.toBeInstanceOf(UpFailedError)
    expect(lines.filter(l => l.startsWith('dokku ps:restart'))).toEqual(['dokku ps:restart good  # env'])
  })
})
