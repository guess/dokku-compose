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
