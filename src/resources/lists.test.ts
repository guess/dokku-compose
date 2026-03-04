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
  function makeCtx(queryResult: string) {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue(queryResult)
    runner.run = vi.fn()
    return createContext(runner)
  }

  it('adds new domains and removes old ones', async () => {
    const ctx = makeCtx('old.example.com\nkeep.example.com')
    await reconcile(Domains, ctx, 'myapp', ['keep.example.com', 'new.example.com'])
    expect(ctx.commands).toContainEqual(['domains:remove', 'myapp', 'old.example.com'])
    expect(ctx.commands).toContainEqual(['domains:add', 'myapp', 'new.example.com'])
  })

  it('skips when domains match', async () => {
    const ctx = makeCtx('example.com')
    await reconcile(Domains, ctx, 'myapp', ['example.com'])
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
    const ctx = makeCtx('/old:/app/old')
    await reconcile(Storage, ctx, 'myapp', ['/new:/app/new'])
    expect(ctx.commands).toContainEqual(['storage:unmount', 'myapp', '/old:/app/old'])
    expect(ctx.commands).toContainEqual(['storage:mount', 'myapp', '/new:/app/new'])
  })

  it('skips when storage matches', async () => {
    const ctx = makeCtx('/data:/app/data')
    await reconcile(Storage, ctx, 'myapp', ['/data:/app/data'])
    expect(ctx.commands).toEqual([])
  })
})
