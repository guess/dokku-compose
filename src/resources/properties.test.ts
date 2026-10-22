// src/resources/properties.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { reconcile } from '../core/reconcile.js'
import { Nginx, Logs, Registry, Scheduler } from './properties.js'

describe('Nginx resource', () => {
  function makeCtx(queryResult: string) {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue(queryResult)
    runner.run = vi.fn()
    return createContext(runner)
  }

  it('sets only modified nginx properties', async () => {
    const ctx = makeCtx(
      '       Nginx client max body size:   1m\n       Nginx proxy read timeout:   60s\n'
    )
    await reconcile(Nginx, ctx, 'myapp', {
      'client-max-body-size': '50m',
      'proxy-read-timeout': '60s',
    })
    expect(ctx.commands).toEqual([
      ['nginx:set', 'myapp', 'client-max-body-size', '50m'],
      ['proxy:build-config', 'myapp'],
    ])
  })

  it('skips when all nginx properties match', async () => {
    const ctx = makeCtx(
      '       Nginx client max body size:   50m\n'
    )
    await reconcile(Nginx, ctx, 'myapp', { 'client-max-body-size': '50m' })
    expect(ctx.commands).toEqual([])
  })

  it('a failing proxy:build-config on an undeployed app warns and continues, without throwing', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn(async (...args: string[]) => {
      if (args[0] === 'ps:report') return 'false' // never deployed
      return '       Nginx client max body size:   1m\n'
    })
    runner.run = vi.fn(async (...args: string[]) => {
      if (args[0] === 'proxy:build-config') throw new Error('nothing to build yet')
    })
    const ctx = createContext(runner)

    await expect(
      reconcile(Nginx, ctx, 'myapp', { 'client-max-body-size': '50m' })
    ).resolves.toBeUndefined()
  })

  it('a failing proxy:build-config on a deployed app rethrows', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn(async (...args: string[]) => {
      if (args[0] === 'ps:report') return 'true' // already deployed
      return '       Nginx client max body size:   1m\n'
    })
    runner.run = vi.fn(async (...args: string[]) => {
      if (args[0] === 'proxy:build-config') throw new Error('real failure')
    })
    const ctx = createContext(runner)

    await expect(
      reconcile(Nginx, ctx, 'myapp', { 'client-max-body-size': '50m' })
    ).rejects.toThrow('real failure')
  })

  it('an unreadable deploy status is treated as not deployed (warns, does not throw)', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn(async (...args: string[]) => {
      if (args[0] === 'ps:report') return '' // unreadable
      return '       Nginx client max body size:   1m\n'
    })
    runner.run = vi.fn(async (...args: string[]) => {
      if (args[0] === 'proxy:build-config') throw new Error('nothing to build yet')
    })
    const ctx = createContext(runner)

    await expect(
      reconcile(Nginx, ctx, 'myapp', { 'client-max-body-size': '50m' })
    ).resolves.toBeUndefined()
  })
})

describe('Scheduler resource', () => {
  function makeCtx(queryResult: string) {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue(queryResult)
    runner.run = vi.fn()
    return createContext(runner)
  }

  it('sets scheduler when different', async () => {
    const ctx = makeCtx(
      '       Scheduler selected:            docker-local\n'
    )
    await reconcile(Scheduler, ctx, 'myapp', 'k3s')
    expect(ctx.commands).toEqual([
      ['scheduler:set', 'myapp', 'selected', 'k3s'],
    ])
  })

  it('skips when scheduler matches', async () => {
    const ctx = makeCtx(
      '       Scheduler selected:            docker-local\n'
    )
    await reconcile(Scheduler, ctx, 'myapp', 'docker-local')
    expect(ctx.commands).toEqual([])
  })
})

describe('Logs resource', () => {
  function makeCtx(queryResult: string) {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue(queryResult)
    runner.run = vi.fn()
    return createContext(runner)
  }

  it('sets only modified log properties', async () => {
    const ctx = makeCtx(
      '       Logs max size:                 10m\n'
    )
    await reconcile(Logs, ctx, 'myapp', { 'max-size': '20m' })
    expect(ctx.commands).toEqual([
      ['logs:set', 'myapp', 'max-size', '20m'],
    ])
  })
})

describe('readAll (bulk)', () => {
  function makeCtx(queryResult: string) {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue(queryResult)
    runner.run = vi.fn()
    return createContext(runner)
  }

  it('Nginx.readAll returns per-app maps', async () => {
    const ctx = makeCtx(
      '=====> app1 nginx information\n' +
      '       Nginx client max body size:   1m\n' +
      '=====> app2 nginx information\n' +
      '       Nginx client max body size:   50m\n'
    )
    const result = await Nginx.readAll!(ctx)
    expect(result.get('app1')).toEqual({ 'client-max-body-size': '1m' })
    expect(result.get('app2')).toEqual({ 'client-max-body-size': '50m' })
  })

  it('Logs.readAll returns per-app maps', async () => {
    const ctx = makeCtx(
      '=====> app1 logs information\n' +
      '       Logs max size:                10m\n'
    )
    const result = await Logs.readAll!(ctx)
    expect(result.get('app1')).toEqual({ 'max-size': '10m' })
  })

  it('Scheduler.readAll returns per-app strings', async () => {
    const ctx = makeCtx(
      '=====> app1 scheduler information\n' +
      '       Scheduler selected:           docker-local\n' +
      '=====> app2 scheduler information\n' +
      '       Scheduler selected:           k3s\n'
    )
    const result = await Scheduler.readAll!(ctx)
    expect(result.get('app1')).toBe('docker-local')
    expect(result.get('app2')).toBe('k3s')
  })

  it('bulk queries use no app argument', async () => {
    const ctx = makeCtx('')
    await Nginx.readAll!(ctx)
    expect(ctx.runner.query).toHaveBeenCalledWith('nginx:report')
  })
})

describe('Registry resource', () => {
  function makeCtx(queryResult: string) {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue(queryResult)
    runner.run = vi.fn()
    return createContext(runner)
  }

  it('sets only modified registry properties', async () => {
    const ctx = makeCtx(
      '       Registry server:               \n       Registry push on release:       false\n'
    )
    await reconcile(Registry, ctx, 'myapp', {
      server: 'docker.io',
      'push-on-release': 'true',
    })
    // server was empty -> added, push-on-release was false -> modified
    expect(ctx.commands.length).toBeGreaterThan(0)
  })
})

// ---- --prune (reconcile's `prune` argument) ----
function pruneCtx(reports: Record<string, string>, run?: (...a: string[]) => Promise<void>) {
  const runner = createRunner({ dryRun: false })
  runner.query = vi.fn(async (...a: string[]) => reports[a.join(' ')] ?? '')
  runner.run = vi.fn(run ?? (async () => {}))
  return { ctx: createContext(runner), runner }
}
const NGINX_BOX = '       Nginx client max body size: 50m\n       Nginx proxy read timeout: 60s\n'

describe('Nginx --prune', () => {
  it('resets each stale key with no value, then rebuilds the proxy config; nothing else', async () => {
    const { ctx } = pruneCtx({ 'nginx:report myapp': NGINX_BOX })
    await reconcile(Nginx, ctx, 'myapp', { 'client-max-body-size': '50m' }, undefined, true)
    expect(ctx.commands).toEqual([['nginx:set', 'myapp', 'proxy-read-timeout'], ['proxy:build-config', 'myapp']])
  })

  it('a change and a prune in one run rebuild the proxy config once, after both', async () => {
    const { ctx } = pruneCtx({ 'nginx:report myapp': NGINX_BOX })
    await reconcile(Nginx, ctx, 'myapp', { 'client-max-body-size': '10m' }, undefined, true)
    expect(ctx.commands).toEqual([
      ['nginx:set', 'myapp', 'client-max-body-size', '10m'],
      ['nginx:set', 'myapp', 'proxy-read-timeout'],
      ['proxy:build-config', 'myapp'],
    ])
  })

  it('without prune nothing is reset', async () => {
    const { ctx } = pruneCtx({ 'nginx:report myapp': NGINX_BOX })
    await reconcile(Nginx, ctx, 'myapp', { 'client-max-body-size': '50m' })
    expect(ctx.commands).toEqual([])
  })

  it('a block gone from the file is read exactly once under prune and never without', async () => {
    const a = pruneCtx({ 'nginx:report myapp': NGINX_BOX })
    await reconcile(Nginx, a.ctx, 'myapp', undefined, undefined, true)
    expect(a.runner.query).toHaveBeenCalledTimes(1)
    expect(a.ctx.commands.map(c => c.slice(0, 3).join(' '))).toEqual([
      'nginx:set myapp client-max-body-size', 'nginx:set myapp proxy-read-timeout', 'proxy:build-config myapp',
    ])
    const b = pruneCtx({ 'nginx:report myapp': NGINX_BOX })
    await reconcile(Nginx, b.ctx, 'myapp', undefined)
    expect(b.runner.query).not.toHaveBeenCalled()
  })

  it('an empty read resets nothing', async () => {
    const { ctx } = pruneCtx({})
    await reconcile(Nginx, ctx, 'myapp', undefined, undefined, true)
    expect(ctx.commands).toEqual([])
  })

  it('a failing rebuild on an undeployed app warns and does not throw', async () => {
    const { ctx } = pruneCtx(
      { 'nginx:report myapp': NGINX_BOX, 'ps:report myapp --deployed': 'false' },
      async (...a) => { if (a[0] === 'proxy:build-config') throw new Error('no config') }
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await reconcile(Nginx, ctx, 'myapp', {}, undefined, true)
    expect(warn.mock.calls.flat().join('')).toContain('proxy:build-config failed on an undeployed app')
    warn.mockRestore()
  })
})

describe('Logs / Registry / Scheduler --prune', () => {
  it('logs and registry: <plugin>:set <app> <key> with no value', async () => {
    const { ctx } = pruneCtx({
      'logs:report myapp': '       Logs max size: 10m\n       Logs vector sink: console://\n',
      'registry:report myapp': '       Registry server: ghcr.io\n',
    })
    await reconcile(Logs, ctx, 'myapp', { 'max-size': '10m' }, undefined, true)
    await reconcile(Registry, ctx, 'myapp', undefined, undefined, true)
    expect(ctx.commands).toEqual([['logs:set', 'myapp', 'vector-sink'], ['registry:set', 'myapp', 'server']])
  })

  it('scheduler: clears selected only when the block is gone', async () => {
    const { ctx } = pruneCtx({ 'scheduler:report myapp': '       Scheduler selected: docker-local\n' })
    await reconcile(Scheduler, ctx, 'myapp', 'k3s', undefined, true)
    expect(ctx.commands.map(c => c[0])).toEqual(['scheduler:set'])
    expect(ctx.commands[0]).toEqual(['scheduler:set', 'myapp', 'selected', 'k3s'])
    const g = pruneCtx({ 'scheduler:report myapp': '       Scheduler selected: docker-local\n' })
    await reconcile(Scheduler, g.ctx, 'myapp', undefined, undefined, true)
    expect(g.ctx.commands).toEqual([['scheduler:set', 'myapp', 'selected']])
  })
})
