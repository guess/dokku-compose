// src/resources/lists.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { reconcile } from '../core/reconcile.js'
import { Ports, Domains, Storage } from './lists.js'

describe('Ports resource', () => {
  function makeCtx(queryResult: string) {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue(queryResult)
    runner.run = vi.fn()
    return createContext(runner)
  }

  it('sets ports when different', async () => {
    const ctx = makeCtx('http:80:4000')
    await reconcile(Ports, ctx, 'myapp', ['http:80:3000'])
    expect(ctx.commands).toEqual([['ports:set', 'myapp', 'http:80:3000']])
  })

  it('skips when ports match (different order)', async () => {
    const ctx = makeCtx('https:443:3000 http:80:3000')
    await reconcile(Ports, ctx, 'myapp', ['http:80:3000', 'https:443:3000'])
    expect(ctx.commands).toEqual([])
  })
})

describe('Domains resource', () => {
  function makeCtx(answers: Record<string, string>) {
    const runner = createRunner({ dryRun: false })
    const answer = vi.fn(async (...args: string[]) => {
      const key = args.join(' ')
      if (key in answers) return answers[key]
      throw new Error(`no answer for ${key}`)
    })
    runner.query = answer
    runner.queryStrict = answer
    runner.run = vi.fn()
    return createContext(runner)
  }
  const enabled = (v: string) => ({ 'domains:report myapp --domains-app-enabled': v })
  const vhosts = (v: string) => ({ 'domains:report myapp --domains-app-vhosts': v })

  it('adds new domains and removes old ones', async () => {
    const ctx = makeCtx({ ...enabled('true'), ...vhosts('old.example.com keep.example.com') })
    await reconcile(Domains, ctx, 'myapp', ['keep.example.com', 'new.example.com'])
    expect(ctx.commands).toContainEqual(['domains:remove', 'myapp', 'old.example.com'])
    expect(ctx.commands).toContainEqual(['domains:add', 'myapp', 'new.example.com'])
  })

  it('skips when domains match', async () => {
    const ctx = makeCtx({ ...enabled('true'), ...vhosts('example.com') })
    await reconcile(Domains, ctx, 'myapp', ['example.com'])
    expect(ctx.commands).toEqual([])
  })

  // Dokku 0.38.31 prints `--domains-app-vhosts` on one line, space-separated.
  it('skips when several domains match, as Dokku prints them on one line', async () => {
    const ctx = makeCtx({ ...enabled('true'), ...vhosts('example.com www.example.com') })
    await reconcile(Domains, ctx, 'myapp', ['www.example.com', 'example.com'])
    expect(ctx.commands).toEqual([])
  })

  it('disables an enabled app for domains: false', async () => {
    const ctx = makeCtx({ ...enabled('true'), ...vhosts('example.com') })
    await reconcile(Domains, ctx, 'myapp', false)
    expect(ctx.commands).toEqual([['domains:disable', 'myapp']])
  })

  it('runs nothing for domains: false on an already disabled app', async () => {
    const ctx = makeCtx(enabled('false'))
    await reconcile(Domains, ctx, 'myapp', false)
    expect(ctx.commands).toEqual([])
  })

  it('enables a disabled app, then sets the list', async () => {
    const ctx = makeCtx(enabled('false'))
    await reconcile(Domains, ctx, 'myapp', ['a.example.com', 'b.example.com'])
    expect(ctx.commands).toEqual([
      ['domains:enable', 'myapp'],
      ['domains:set', 'myapp', 'a.example.com', 'b.example.com'],
    ])
  })

  function newAppCtx() {
    const runner = createRunner({ dryRun: true })
    runner.queryStrict = vi.fn(async () => { throw new Error('app myapp does not exist') })
    runner.query = vi.fn(async () => '')
    runner.check = vi.fn(async () => false)
    return createContext(runner)
  }

  it('plans domains: [list] for an app that does not exist yet', async () => {
    const ctx = newAppCtx()
    await reconcile(Domains, ctx, 'myapp', ['a.example.com'])
    expect(ctx.commands).toEqual([['domains:add', 'myapp', 'a.example.com']])
  })

  it('plans domains: false for an app that does not exist yet', async () => {
    const ctx = newAppCtx()
    await reconcile(Domains, ctx, 'myapp', false)
    expect(ctx.commands).toEqual([['domains:disable', 'myapp']])
  })

  it('still throws when an existing app cannot be read', async () => {
    const runner = createRunner({ dryRun: false })
    runner.queryStrict = vi.fn(async () => { throw new Error('boom') })
    runner.check = vi.fn(async () => true)
    await expect(reconcile(Domains, createContext(runner), 'myapp', false)).rejects.toThrow('boom')
  })

  it('throws, running nothing, when the enabled state is unreadable', async () => {
    const ctx = makeCtx(enabled('weird'))
    await expect(reconcile(Domains, ctx, 'myapp', false)).rejects.toThrow(/domains-app-enabled/)
    expect(ctx.commands).toEqual([])
  })
})

describe('Storage resource', () => {
  function makeCtx(queryResult: string) {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue(queryResult)
    runner.run = vi.fn()
    return createContext(runner)
  }

  it('mounts new and unmounts removed storage', async () => {
    const ctx = makeCtx('-v /old:/app/old')
    await reconcile(Storage, ctx, 'myapp', ['/new:/app/new'])
    expect(ctx.commands).toContainEqual(['storage:unmount', 'myapp', '/old:/app/old'])
    expect(ctx.commands).toContainEqual(['storage:mount', 'myapp', '/new:/app/new'])
  })

  it('skips when storage matches', async () => {
    const ctx = makeCtx('-v /data:/app/data')
    await reconcile(Storage, ctx, 'myapp', ['/data:/app/data'])
    expect(ctx.commands).toEqual([])
  })

  it('parses multiple `-v` mounts on one line', async () => {
    const ctx = makeCtx('-v /a:/app/a -v /b:/app/b')
    await reconcile(Storage, ctx, 'myapp', ['/a:/app/a', '/b:/app/b'])
    expect(ctx.commands).toEqual([])
  })
})

describe('readAll (bulk)', () => {
  function makeCtx(queryResult: string) {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue(queryResult)
    runner.run = vi.fn()
    return createContext(runner)
  }

  it('Ports.readAll returns per-app port arrays', async () => {
    const ctx = makeCtx(
      '=====> app1 ports information\n' +
      '       Ports map:                    http:80:3000 https:443:3000\n' +
      '=====> app2 ports information\n' +
      '       Ports map:                    http:80:4000\n'
    )
    const result = await Ports.readAll!(ctx)
    expect(result.get('app1')).toEqual(['http:80:3000', 'https:443:3000'])
    expect(result.get('app2')).toEqual(['http:80:4000'])
  })

  it('Domains.readAll returns per-app domain arrays', async () => {
    const ctx = makeCtx(
      '=====> app1 domains information\n' +
      '       Domains app enabled:          true\n' +
      '       Domains app vhosts:           example.com\n' +
      '=====> app2 domains information\n' +
      '       Domains app enabled:          true\n' +
      '       Domains app vhosts:           foo.com bar.com\n' +
      '=====> app3 domains information\n' +
      '       Domains app enabled:          false\n' +
      '       Domains app vhosts:\n'
    )
    const result = await Domains.readAll!(ctx)
    expect(result.get('app1')).toEqual(['example.com'])
    expect(result.get('app2')).toEqual(['foo.com', 'bar.com'])
    expect(result.get('app3')).toBe(false)
  })

  it('Storage.readAll returns per-app mount arrays', async () => {
    const ctx = makeCtx(
      '=====> app1 storage information\n' +
      '       Storage build mounts:\n' +
      '       Storage deploy mounts:        -v /data:/app/data -v /logs:/app/logs\n' +
      '       Storage run mounts:           -v /data:/app/data -v /logs:/app/logs\n'
    )
    const result = await Storage.readAll!(ctx)
    expect(result.get('app1')).toEqual(['/data:/app/data', '/logs:/app/logs'])
  })

  it('handles empty field values as empty arrays', async () => {
    const ctx = makeCtx(
      '=====> app1 ports information\n' +
      '       Ports map:                    \n'
    )
    const result = await Ports.readAll!(ctx)
    expect(result.get('app1')).toEqual([])
  })
})
