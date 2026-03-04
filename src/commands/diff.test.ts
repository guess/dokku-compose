import { describe, it, expect, vi } from 'vitest'
import { computeDiff, formatSummary, formatVerbose } from './diff.js'
import type { Config } from '../core/schema.js'
import type { Context } from '../core/context.js'

function makeCtx(queryMap: Record<string, string>, checkMap: Record<string, boolean> = {}): Context {
  return {
    query: vi.fn(async (...args: string[]) => {
      const key = args.join(' ')
      return queryMap[key] ?? ''
    }),
    check: vi.fn(async (...args: string[]) => {
      const key = args.join(' ')
      return checkMap[key] ?? false
    }),
    run: vi.fn(),
    commands: [],
    runner: {} as any,
    close: vi.fn(),
  }
}

const desired: Config = {
  apps: {
    api: {
      ports: ['http:80:3000'],
      domains: ['api.example.com'],
    }
  }
}

describe('computeDiff', () => {
  it('detects port change', async () => {
    const ctx = makeCtx({
      'ports:report api --ports-map': 'http:80:4000',
      'domains:report api --domains-app-vhosts': 'api.example.com',
    })
    const diff = await computeDiff(ctx, desired)
    expect(diff.apps['api'].ports?.status).toBe('changed')
  })

  it('detects missing domain', async () => {
    const ctx = makeCtx({
      'ports:report api --ports-map': 'http:80:3000',
      'domains:report api --domains-app-vhosts': '',
    })
    const diff = await computeDiff(ctx, desired)
    expect(diff.apps['api'].domains?.status).toBe('missing')
  })

  it('reports in-sync when identical', async () => {
    const ctx = makeCtx({
      'ports:report api --ports-map': 'http:80:3000',
      'domains:report api --domains-app-vhosts': 'api.example.com',
    })
    const diff = await computeDiff(ctx, desired)
    expect(diff.inSync).toBe(true)
  })
})

describe('formatSummary', () => {
  it('shows changed and missing items', async () => {
    const ctx = makeCtx({
      'ports:report api --ports-map': 'http:80:4000',
      'domains:report api --domains-app-vhosts': '',
    })
    const diff = await computeDiff(ctx, desired)
    const output = formatSummary(diff)
    expect(output).toContain('api')
    expect(output).toContain('ports')
    expect(output).toContain('domains')
  })
})

describe('formatVerbose', () => {
  it('shows +/- lines', async () => {
    const ctx = makeCtx({
      'ports:report api --ports-map': 'http:80:4000',
      'domains:report api --domains-app-vhosts': '',
    })
    const diff = await computeDiff(ctx, desired)
    const output = formatVerbose(diff)
    expect(output).toContain('+')
    expect(output).toContain('-')
  })
})
