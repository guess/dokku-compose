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
      if (key in checkMap) return checkMap[key]
      // Existing tests assume every configured app already exists on the
      // server; a test exercising the "app doesn't exist yet" path passes
      // an explicit `'apps:exists <app>': false` override.
      if (args[0] === 'apps:exists') return true
      return false
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

describe('computeDiff — apps that do not exist yet (first run)', () => {
  // Regression: planning a config whose apps have not been created yet must
  // report every desired resource as 'missing', never 'unknown' — the old
  // heuristic counted configured apps, not apps that exist on the server,
  // so a first run against an empty box produced 'unknown' + read warnings.

  it('server has no apps: every desired resource is missing, no readWarnings', async () => {
    const ctx = makeCtx(
      {
        'ports:report': '',
        'domains:report': '',
      },
      { 'apps:exists api': false }
    )
    const diff = await computeDiff(ctx, desired)
    expect(diff.apps['api'].ports?.status).toBe('missing')
    expect(diff.apps['api'].domains?.status).toBe('missing')
    expect(diff.readWarnings).toEqual([])
    expect(diff.inSync).toBe(false)
  })

  it('app exists, bulk empty, per-app read works: in-sync', async () => {
    const ctx = makeCtx(
      {
        'ports:report': '',
        'ports:report api --ports-map': 'http:80:3000',
        'domains:report': '',
        'domains:report api --domains-app-vhosts': 'api.example.com',
      },
      { 'apps:exists api': true }
    )
    const diff = await computeDiff(ctx, desired)
    expect(diff.apps['api'].ports?.status).toBe('in-sync')
    expect(diff.apps['api'].domains?.status).toBe('in-sync')
  })

  it('app exists, bulk empty, per-app empty: unknown + warning', async () => {
    const ctx = makeCtx(
      {
        'ports:report': '',
        'ports:report api --ports-map': '',
        'domains:report': '',
        'domains:report api --domains-app-vhosts': '',
      },
      { 'apps:exists api': true }
    )
    const diff = await computeDiff(ctx, desired)
    expect(diff.apps['api'].domains?.status).toBe('unknown')
    expect(diff.readWarnings.length).toBeGreaterThan(0)
  })
})

describe('computeDiff — ssl unreadable report', () => {
  // Regression for the incident: certs:report coming back empty/unreadable
  // must never be coerced to `false` (no cert), which would report
  // 'missing' for an installed cert. It must defer to the generic unknown
  // handling instead.

  it('empty certs:report (bulk and per-app) reports unknown, not missing', async () => {
    const sslDesired: Config = {
      apps: {
        api: { ssl: { certfile: '/certs/api.crt', keyfile: '/certs/api.key' } }
      }
    }
    const ctx = makeCtx({
      'certs:report': '',
      'certs:report api --ssl-enabled': '',
    })
    const diff = await computeDiff(ctx, sslDesired)
    expect(diff.apps['api'].ssl?.status).toBe('unknown')
    expect(diff.apps['api'].ssl?.status).not.toBe('missing')
  })

  it('bulk certs:report section missing the enabled key falls back to per-app read', async () => {
    const sslDesired: Config = {
      apps: {
        api: { ssl: { certfile: '/certs/api.crt', keyfile: '/certs/api.key' } }
      }
    }
    const ctx = makeCtx({
      // Bulk report parses (non-empty), but api's section has no "enabled" line.
      'certs:report': '=====> api ssl information\n       Other:  x\n',
      'certs:report api --ssl-enabled': 'true',
    })
    const diff = await computeDiff(ctx, sslDesired)
    expect(diff.apps['api'].ssl?.status).toBe('in-sync')
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

  it('prints read warnings, same as formatSummary', async () => {
    const ctx = makeCtx({
      'domains:report': '',
      'domains:report api --domains-app-vhosts': '',
      'ports:report': portsReport('api', 'http:80:3000'),
    })
    const diff = await computeDiff(ctx, desired)
    expect(diff.readWarnings.length).toBeGreaterThan(0)
    const output = formatVerbose(diff)
    expect(output).toContain(diff.readWarnings[0])
  })

  it('renders an unknown entry distinctly, not as a +/- change block', async () => {
    const ctx = makeCtx({
      'domains:report': '',
      'domains:report api --domains-app-vhosts': '',
      'ports:report': portsReport('api', 'http:80:3000'),
    })
    const diff = await computeDiff(ctx, desired)
    expect(diff.apps['api'].domains?.status).toBe('unknown')
    const output = formatVerbose(diff)
    expect(output).toContain('could not read server state')
    // No proposed-change lines for the unknown domains feature.
    expect(output).not.toMatch(/- \[\s*\n\s*"api\.example\.com"/)
  })
})
