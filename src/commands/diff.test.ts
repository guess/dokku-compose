import { describe, it, expect, vi } from 'vitest'
import { computeDiff, formatSummary, formatVerbose, maskDiffResult } from './diff.js'
import type { Config } from '../core/schema.js'
import type { Context } from '../core/context.js'
import { emptyAnswer, logsGlobalJson } from '../tests/fake-server.js'
import { readFileSync } from 'node:fs'

function makeCtx(queryMap: Record<string, string>, checkMap: Record<string, boolean> = {}): Context {
  return {
    query: vi.fn(async (...args: string[]) => {
      const key = args.join(' ')
      if (key === 'version' && !(key in queryMap)) return 'dokku version 0.38.31'
      return queryMap[key] ?? emptyAnswer(...args) ?? ''
    }),
    queryStrict: vi.fn(async (...args: string[]) => {
      const key = args.join(' ')
      return queryMap[key] ?? emptyAnswer(...args) ?? ''
    }),
    status: vi.fn(async () => 1),
    runWithInput: vi.fn(),
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
    restarts: new Map(),
    needsRestart: vi.fn(),
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

})

describe('computeDiff — ssl compares the installed certificate', () => {
  const sslDesired: Config = {
    apps: { api: { ssl: { certfile: 'src/tests/fixtures/certs/myapp.crt', keyfile: 'src/tests/fixtures/certs/myapp.key' } } },
  }
  const fileCrt = readFileSync('src/tests/fixtures/certs/myapp.crt', 'utf8')

  it('the same certificate (trailing whitespace aside) is in sync', async () => {
    const ctx = makeCtx({ 'certs:report api --ssl-enabled': 'true', 'certs:show api crt': fileCrt.trimEnd() + '\n\n' })
    const diff = await computeDiff(ctx, sslDesired)
    expect(diff.apps['api'].ssl?.status).toBe('in-sync')
    expect(diff.inSync).toBe(true)
  })

  it('a replaced certificate is drift, shown without the certificate text', async () => {
    const ctx = makeCtx({ 'certs:report api --ssl-enabled': 'true', 'certs:show api crt': '-----BEGIN CERTIFICATE-----\nT3RoZXI=\n-----END CERTIFICATE-----' })
    const diff = await computeDiff(ctx, sslDesired)
    expect(diff.apps['api'].ssl?.status).toBe('changed')
    expect(diff.inSync).toBe(false)
    for (const out of [formatSummary(diff), formatVerbose(diff)]) {
      expect(out).toContain('(certificate installed)')
      expect(out).not.toContain('BEGIN CERTIFICATE')
    }
  })

  it('no certificate is missing', async () => {
    const ctx = makeCtx({ 'certs:report api --ssl-enabled': 'false' })
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

  it('reports plugin version drift and leaves in-sync plugins out', async () => {
    const ctx = makeCtx({
      'plugin:list --format json': JSON.stringify([{ name: 'postgres', version: '1.0.0' }, { name: 'redis', version: '1.2.0' }]),
    })
    const cfg: Config = {
      apps: {},
      plugins: {
        postgres: { url: 'https://example.com/p.git', version: '1.2.0' },
        redis: { url: 'https://example.com/r.git', version: '1.2.0' },
        extra: { url: 'https://example.com/e.git', version: '1.0.0' },
      },
    }
    const diff = await computeDiff(ctx, cfg)
    expect(diff.plugins.postgres.status).toBe('changed')
    expect(diff.plugins.redis).toBeUndefined()
    expect(diff.plugins.extra.status).toBe('missing')
    expect(diff.inSync).toBe(false)
  })

  it('shows scale drift but not a process type removed from the file', async () => {
    const table = JSON.stringify([{ process_type: 'web', quantity: 1 }, { process_type: 'worker', quantity: 0 }])
    const ctx = makeCtx({ 'ps:scale --format json api': table })
    const drift = await computeDiff(ctx, { apps: { api: { scale: { web: 1, worker: 1 } } } })
    expect(drift.apps.api.scale?.status).toBe('changed')
    const same = await computeDiff(makeCtx({ 'ps:scale --format json api': table }), { apps: { api: { scale: { web: 1 } } } })
    expect(same.apps.api.scale?.status).toBe('in-sync')
  })

  it('shows an uncomparable plugin pin as unknown without failing the check', async () => {
    const ctx = makeCtx({ 'plugin:list --format json': JSON.stringify([{ name: 'p', version: '1.0.0' }]) })
    const diff = await computeDiff(ctx, { apps: {}, plugins: { p: { url: 'https://example.com/p.git', version: '1.0' } } })
    expect(diff.plugins.p.status).toBe('unknown')
    expect(diff.inSync).toBe(true)
  })
})

describe('computeDiff — settings removed from the file', () => {
  const nginxBulk = '=====> api nginx information\n       Nginx client max body size:   50m\n       Nginx proxy read timeout:   60s\n'

  it('nginx: a key only on the box is "-" and drift; the declared one is in sync', async () => {
    const ctx = makeCtx({ 'nginx:report': nginxBulk })
    const diff = await computeDiff(ctx, { apps: { api: { nginx: { 'client-max-body-size': '50m' } } } })
    expect(diff.apps.api.nginx).toMatchObject({ status: 'extra', removed: ['proxy-read-timeout'] })
    expect(diff.inSync).toBe(false)
    expect(formatSummary(diff)).toContain('- nginx: not in the file: proxy-read-timeout')
  })

  it('nginx: whole block gone from the file', async () => {
    const ctx = makeCtx({ 'nginx:report': nginxBulk })
    const diff = await computeDiff(ctx, { apps: { api: {} } })
    expect(diff.apps.api.nginx).toMatchObject({ status: 'extra', removed: ['client-max-body-size', 'proxy-read-timeout'] })
    expect(diff.inSync).toBe(false)
  })

  it('nginx: nothing set on the box and no block is in sync', async () => {
    const diff = await computeDiff(makeCtx({}), { apps: { api: {} } })
    expect(diff.apps.api.nginx).toBeUndefined()
    expect(diff.inSync).toBe(true)
  })

  it('nginx: a changed value plus a removal stays "changed" and lists the removal', async () => {
    const ctx = makeCtx({ 'nginx:report': nginxBulk })
    const diff = await computeDiff(ctx, { apps: { api: { nginx: { 'client-max-body-size': '1m' } } } })
    expect(diff.apps.api.nginx).toMatchObject({ status: 'changed', removed: ['proxy-read-timeout'] })
  })

  it('logs and registry', async () => {
    const ctx = makeCtx({
      'logs:report api --format json': JSON.stringify({ 'max-size': '10m', 'computed-max-size': '10m' }),
      'registry:report': '=====> api registry information\n       Registry server:  ghcr.io\n',
    })
    const diff = await computeDiff(ctx, { apps: { api: {} } })
    expect(diff.apps.api.logs).toMatchObject({ status: 'extra', removed: ['max-size'] })
    expect(diff.apps.api.registry).toMatchObject({ status: 'extra', removed: ['server'] })
  })

  it('scheduler', async () => {
    const ctx = makeCtx({ 'scheduler:report': '=====> api scheduler information\n       Scheduler selected:  docker-local\n' })
    const diff = await computeDiff(ctx, { apps: { api: {} } })
    expect(diff.apps.api.scheduler).toMatchObject({ status: 'extra', removed: ['scheduler'] })
  })

  it('proxy: "Proxy enabled" on the box is never "-"', async () => {
    const ctx = makeCtx({ 'proxy:report': '=====> api proxy information\n       Proxy enabled:  true\n' })
    const diff = await computeDiff(ctx, { apps: { api: {} } })
    expect(diff.apps.api.proxy).toBeUndefined()
    expect(diff.inSync).toBe(true)
  })

  it('checks: leftover settings are "-"', async () => {
    const ctx = makeCtx({ 'checks:report api': '       Checks disabled list: none\n       Checks wait to retire: 10\n       Checks computed wait to retire: 5\n' })
    const diff = await computeDiff(ctx, { apps: { api: {} } })
    expect(diff.apps.api.checks).toMatchObject({ status: 'extra', removed: ['wait-to-retire'] })
    const declared = await computeDiff(makeCtx({ 'checks:report api': '       Checks disabled list: none\n       Checks wait to retire: 10\n' }), { apps: { api: { checks: { 'wait-to-retire': 10 } } } })
    expect(declared.apps.api.checks?.status).toBe('in-sync')
    expect(declared.inSync).toBe(true)
  })

  it('ps: allowlisted keys are "-", read-only report fields never', async () => {
    const report = JSON.stringify({ 'restart-policy': 'always', deployed: 'true', running: 'true', 'computed-restart-policy': 'always' })
    const diff = await computeDiff(makeCtx({ 'ps:report api --format json': report }), { apps: { api: {} } })
    expect(diff.apps.api.ps).toMatchObject({ status: 'extra', removed: ['restart-policy'] })
    const readOnly = JSON.stringify({ deployed: 'true', running: 'true', 'status-web-1': 'running' })
    const clean = await computeDiff(makeCtx({ 'ps:report api --format json': readOnly }), { apps: { api: {} } })
    expect(clean.apps.api.ps).toBeUndefined()
    expect(clean.inSync).toBe(true)
  })

  it('ps: an unreadable report while the block is gone is a warning, not a failed diff', async () => {
    const ctx = makeCtx({})
    ctx.queryStrict = vi.fn(async () => { throw new Error('boom') })
    const diff = await computeDiff(ctx, { apps: { api: {} } })
    expect(diff.readWarnings.join('\n')).toContain("'ps' for app 'api'")
  })

  it('network properties', async () => {
    const ctx = makeCtx({ 'network:report': '=====> api network information\n       Network tld:  internal\n       Network web listeners:  1.2.3.4:5000\n' })
    const diff = await computeDiff(ctx, { apps: { api: {} } })
    expect(diff.apps.api.network).toMatchObject({ status: 'extra', removed: ['tld'] })
  })

  it('build args: a --build-arg not in build.args is "-"', async () => {
    const ctx = makeCtx({
      'builder:report': '=====> api builder information\n       Builder build dir:  apps/x\n',
      'docker-options:report api --format json': JSON.stringify({ 'build-list': ['--build-arg A=1', '--build-arg B=2'] }),
    })
    const diff = await computeDiff(ctx, { apps: { api: { build: { args: { A: '1' } } } } })
    expect(diff.apps.api.build).toMatchObject({ status: 'extra', removed: ['args.B'] })
    const gone = await computeDiff(ctx, { apps: { api: {} } })
    expect(gone.apps.api.build).toMatchObject({ status: 'extra', removed: ['args.A', 'args.B'] })
  })

  it('env: managed keys gone from the file are "-"', async () => {
    const ctx = makeCtx({
      'config:get api DOKKU_COMPOSE_MANAGED_KEYS': 'A,B',
      'config:export --format json api': JSON.stringify({ A: '1', B: '2' }),
    })
    const diff = await computeDiff(ctx, { apps: { api: { env: { A: '1' } } } })
    expect(diff.apps.api.env).toMatchObject({ status: 'extra', removed: ['B'] })
    const gone = await computeDiff(ctx, { apps: { api: {} } })
    expect(gone.apps.api.env).toMatchObject({ status: 'extra', removed: ['A', 'B'] })
  })

  it('lists: a domain only on the box is "-"', async () => {
    const ctx = makeCtx({ 'domains:report': domainsReport('api', 'a.example.com b.example.com') })
    const diff = await computeDiff(ctx, { apps: { api: { domains: ['a.example.com'] } } })
    expect(diff.apps.api.domains).toMatchObject({ status: 'extra', removed: ['b.example.com'] })
  })

  it('links: warns when the file has no links: but the box has links', async () => {
    const ctx = makeCtx({}, { 'postgres:linked db api': true })
    const diff = await computeDiff(ctx, { postgres: { db: {} }, apps: { api: {} } })
    expect(diff.apps.api.links).toMatchObject({ status: 'extra', removed: ['db'] })
    expect(diff.inSync).toBe(false)
    expect(formatSummary(diff)).toContain('up will unlink')
    const declared = await computeDiff(makeCtx({}, { 'postgres:linked db api': true }), { postgres: { db: {} }, apps: { api: { links: ['db'] } } })
    expect(declared.apps.api.links).toBeUndefined()
  })

  it('verbose renders a marked key gone from the app as (unset)', async () => {
    const ctx = makeCtx({
      'config:get api DOKKU_COMPOSE_MANAGED_KEYS': 'A',
      'config:export --format json api': JSON.stringify({}),
    })
    const diff = await computeDiff(ctx, { apps: { api: { env: { A: '1' } } } })
    const out = formatVerbose(diff)
    expect(out).toContain('(unset)')
    expect(out).not.toContain('missing')
    expect(out).not.toContain('\\u0000')
  })

  it('verbose prints "-" lines for removals', async () => {
    const ctx = makeCtx({ 'nginx:report': nginxBulk })
    const out = formatVerbose(await computeDiff(ctx, { apps: { api: {} } }))
    expect(out).toContain('@@ app: api / nginx @@')
    expect(out).toContain('- proxy-read-timeout')
  })
})

describe('computeDiff — global settings, networks and the in-sync line', () => {
  const globals: Config = { logs: { 'max-size': '50m' }, nginx: { 'client-max-body-size': '20m' }, apps: {} }

  it('global logs and nginx already set are in sync', async () => {
    const ctx = makeCtx({
      'logs:report --global --format json': JSON.stringify({ 'global-max-size': '50m', 'computed-max-size': '50m' }),
      'nginx:report --global --format json': JSON.stringify({ 'global-client-max-body-size': '20m' }),
    })
    const diff = await computeDiff(ctx, globals)
    expect(diff.global).toEqual({})
    expect(diff.inSync).toBe(true)
  })

  it('a changed global value is "~", an unset one "+", each under a global section', async () => {
    const ctx = makeCtx({
      'logs:report --global --format json': JSON.stringify({ 'global-max-size': '10m' }),
      'nginx:report --global --format json': JSON.stringify({ 'global-client-max-body-size': '' }),
    })
    const diff = await computeDiff(ctx, globals)
    expect(diff.global.logs).toMatchObject({ status: 'changed', current: { 'max-size': '10m' } })
    expect(diff.global.nginx).toMatchObject({ status: 'missing' })
    expect(diff.inSync).toBe(false)
    expect(formatSummary(diff)).toContain('2 resource(s) out of sync')
    expect(formatVerbose(diff)).toContain('@@ global / logs @@')
    expect(formatVerbose(diff)).not.toContain('Everything in sync.')
  })

  it('an unreadable global report is unknown with a warning, never missing', async () => {
    const ctx = makeCtx({ 'logs:report --global --format json': '', 'nginx:report --global --format json': '{}' })
    const diff = await computeDiff(ctx, { logs: { 'max-size': '50m' }, apps: {} })
    expect(diff.global.logs?.status).toBe('unknown')
    expect(diff.readWarnings.join('\n')).toContain("global 'logs'")
    expect(diff.inSync).toBe(false)
  })

  it('a declared network missing on the server shows as missing; an existing one does not', async () => {
    const ctx = makeCtx({}, { 'network:exists backend-net': true, 'network:exists other-net': false })
    const diff = await computeDiff(ctx, { networks: ['backend-net', 'other-net'], apps: {} })
    expect(diff.networks).toEqual({ 'other-net': { status: 'missing' } })
    expect(diff.inSync).toBe(false)
    expect(formatSummary(diff)).toContain('other-net: not created')
    expect(formatVerbose(diff)).toContain('+ other-net')
  })

  it('verbose prints "Everything in sync." when nothing differs', async () => {
    const diff = await computeDiff(makeCtx({}, { 'network:exists backend-net': true }), { networks: ['backend-net'], apps: {} })
    expect(diff.inSync).toBe(true)
    expect(formatVerbose(diff)).toContain('Everything in sync.')
  })

  it('checks that differ from the server are drift', async () => {
    const ctx = makeCtx({ 'checks:report api': '       Checks disabled list: none\n       Checks wait to retire: 10\n' })
    const diff = await computeDiff(ctx, { apps: { api: { checks: { 'wait-to-retire': 60 } } } })
    expect(diff.apps.api.checks?.status).toBe('changed')
    expect(diff.inSync).toBe(false)
  })
})

describe('computeDiff — review round 1', () => {
  it('global domains: equal (any order) is in sync, different is drift, unreadable is unknown', async () => {
    const same = await computeDiff(makeCtx({ 'domains:report --global --domains-global-vhosts': 'b.example.com a.example.com' }), { domains: ['a.example.com', 'b.example.com'], apps: {} })
    expect(same.global).toEqual({})
    expect(same.inSync).toBe(true)
    const off = await computeDiff(makeCtx({ 'domains:report --global --domains-global-vhosts': 'a.example.com' }), { domains: false, apps: {} })
    expect(off.global.domains?.status).toBe('changed')
    expect(formatSummary(off)).toContain('1 resource(s) out of sync')
    const ctx = makeCtx({})
    ctx.queryStrict = vi.fn(async () => { throw new Error('boom') })
    const unread = await computeDiff(ctx, { domains: ['a.example.com'], apps: {} })
    expect(unread.global.domains?.status).toBe('unknown')
    expect(unread.readWarnings.join('\n')).toContain("global 'domains'")
  })

  it('an unreadable certfile is unknown with a warning naming it, and the diff continues', async () => {
    const ctx = makeCtx({ 'certs:report api --ssl-enabled': 'true', 'certs:show api crt': 'x', 'ports:report api --ports-map': 'http:80:3000' })
    const diff = await computeDiff(ctx, { apps: { api: { ssl: { certfile: 'no/such/file.crt', keyfile: 'k' }, ports: ['http:80:3000'] } } })
    expect(diff.apps.api.ssl?.status).toBe('unknown')
    expect(diff.apps.api.ports?.status).toBe('in-sync')
    expect(diff.readWarnings.join('\n')).toContain('no/such/file.crt')
  })

  it('log sinks are masked in diff output', async () => {
    const dsn = 'http://user:hunter2@logs.example.com/ingest'
    const ctx = makeCtx({ 'logs:report --global --format json': logsGlobalJson({ 'global-vector-sink': 'http://old' }) })
    const diff = maskDiffResult(await computeDiff(ctx, { logs: { 'vector-sink': dsn }, apps: {} }))
    const out = formatVerbose(diff) + formatSummary(diff)
    expect(out).not.toContain('hunter2')
    expect(out).not.toContain('http://old')
  })
})
