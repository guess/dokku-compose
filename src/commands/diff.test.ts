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

// Bulk report format helpers
function portsReport(app: string, value: string) {
  return `=====> ${app} ports information\n       Ports map:                    ${value}\n`
}
function domainsReport(app: string, value: string) {
  return `=====> ${app} domains information\n       Domains app vhosts:           ${value}\n`
}

describe('computeDiff', () => {
  it('detects port change', async () => {
    const ctx = makeCtx({
      'ports:report': portsReport('api', 'http:80:4000'),
      'domains:report': domainsReport('api', 'api.example.com'),
    })
    const diff = await computeDiff(ctx, desired)
    expect(diff.apps['api'].ports?.status).toBe('changed')
  })

  it('detects missing domain', async () => {
    const ctx = makeCtx({
      'ports:report': portsReport('api', 'http:80:3000'),
      'domains:report': domainsReport('api', ''),
    })
    const diff = await computeDiff(ctx, desired)
    expect(diff.apps['api'].domains?.status).toBe('missing')
  })

  it('reports in-sync when identical', async () => {
    const ctx = makeCtx({
      'ports:report': portsReport('api', 'http:80:3000'),
      'domains:report': domainsReport('api', 'api.example.com'),
    })
    const diff = await computeDiff(ctx, desired)
    expect(diff.inSync).toBe(true)
  })
})

describe('computeDiff — bulk report read failures', () => {
  // Regression for the real incident: on a real Dokku box, execa's default
  // stdin:'pipe' made bash-plugin report commands (nginx:report,
  // certs:report, domains:report, ...) silently exit 0 with empty stdout.
  // diff must never read that empty bulk report as "every app is missing
  // this resource" — it has to fall back to a per-app read, and only when
  // that also comes back empty should it call the resource 'unknown'.

  it('empty bulk report + a working per-app read reports in-sync, not missing', async () => {
    const ctx = makeCtx({
      // Bulk domains:report comes back empty (the bug), but the per-app
      // fallback query with a target arg still works.
      'domains:report': '',
      'domains:report api --domains-app-vhosts': 'api.example.com',
      'ports:report': portsReport('api', 'http:80:3000'),
    })
    const diff = await computeDiff(ctx, desired)
    expect(diff.apps['api'].domains?.status).toBe('in-sync')
    expect(diff.readWarnings).toEqual([])
  })

  it('empty bulk report + a failing per-app read reports unknown, never missing', async () => {
    const ctx = makeCtx({
      'domains:report': '',
      'domains:report api --domains-app-vhosts': '', // per-app fallback also empty
      'ports:report': portsReport('api', 'http:80:3000'),
    })
    const diff = await computeDiff(ctx, desired)
    expect(diff.apps['api'].domains?.status).toBe('unknown')
    expect(diff.apps['api'].domains?.status).not.toBe('missing')
    expect(diff.inSync).toBe(false)
    expect(diff.readWarnings.length).toBeGreaterThan(0)
  })

  it('ssl: desired object vs current true (cert present) is in-sync, not changed', async () => {
    const sslDesired: Config = {
      apps: {
        api: { ssl: { certfile: '/certs/api.crt', keyfile: '/certs/api.key' } }
      }
    }
    const ctx = makeCtx({
      'certs:report': '=====> api ssl information\n       Ssl enabled:                  true\n',
    })
    const diff = await computeDiff(ctx, sslDesired)
    expect(diff.apps['api'].ssl?.status).toBe('in-sync')
  })

  it('ssl: desired object vs current false (no cert) is missing', async () => {
    const sslDesired: Config = {
      apps: {
        api: { ssl: { certfile: '/certs/api.crt', keyfile: '/certs/api.key' } }
      }
    }
    const ctx = makeCtx({
      'certs:report': '=====> api ssl information\n       Ssl enabled:                  false\n',
    })
    const diff = await computeDiff(ctx, sslDesired)
    expect(diff.apps['api'].ssl?.status).toBe('missing')
  })
})

describe('formatSummary', () => {
  it('shows changed and missing items', async () => {
    const ctx = makeCtx({
      'ports:report': portsReport('api', 'http:80:4000'),
      'domains:report': domainsReport('api', ''),
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
      'ports:report': portsReport('api', 'http:80:4000'),
      'domains:report': domainsReport('api', ''),
    })
    const diff = await computeDiff(ctx, desired)
    const output = formatVerbose(diff)
    expect(output).toContain('+')
    expect(output).toContain('-')
  })
})
