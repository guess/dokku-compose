import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { runExport } from './export.js'
import { emptyAnswer, logsAppJson } from '../tests/fake-server.js'

// Strict reads go through the same stub as lenient ones; an empty JSON
// report reads as nothing set.
function stubStrict(runner: ReturnType<typeof createRunner>) {
  runner.queryStrict = vi.fn(async (...args: string[]) => {
    const out = await runner.query(...args)
    if (out) return out
    if (args[0] === 'plugin:list') return '[]'
    return args.includes('json') ? '{}' : out
  })
}

describe('runExport', () => {
  it('includes dokku version from version command', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'version') return 'dokku version 0.38.31'
      return ''
    })
    runner.check = vi.fn().mockResolvedValue(false)
    stubStrict(runner)
    const result = await runExport(runner, {})
    expect(result.dokku).toEqual({ version: '0.38.31' })
  })

  it('uses bulk report queries (no app arg) for resources', async () => {
    const runner = createRunner({ dryRun: false })
    const queryCalls: string[][] = []
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      queryCalls.push(args)
      if (args[0] === 'apps:list') return 'myapp'
      if (args[0] === 'version') return 'dokku version 0.38.31'
      return ''
    })
    runner.check = vi.fn().mockResolvedValue(false)
    stubStrict(runner)
    await runExport(runner, {})
    // Should call bulk reports without app arg
    const bulkCalls = queryCalls.filter(
      c => c[0].endsWith(':report') && c.length === 1 && c[0] !== 'apps:report' && c[0] !== 'ps:report'
    )
    // Should have bulk calls for: nginx, registry, scheduler, proxy, ports, domains, storage, network, git, builder
    expect(bulkCalls.length).toBeGreaterThanOrEqual(10)
    // Should NOT have per-app report calls, except those with no bulk read: ps reads per-app JSON,
    // build settings read per app (build-list only exists in the per-app docker-options JSON),
    // logs reads per-app JSON (the bulk report redacts sinks), and certs reads the installed certificate.
    const perApp = ['apps:report', 'ps:report', 'builder:report', 'builder-dockerfile:report', 'app-json:report', 'docker-options:report', 'logs:report', 'certs:report']
    const perAppReportCalls = queryCalls.filter(
      c => c[0].endsWith(':report') && c.length >= 2 && !perApp.includes(c[0])
    )
    expect(perAppReportCalls).toEqual([])
  })

  it('respects appFilter', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn(async (...args: string[]) => args[0] === 'version' ? 'dokku version 0.38.31' : '')
    runner.check = vi.fn().mockResolvedValue(false)
    stubStrict(runner)
    const result = await runExport(runner, { appFilter: ['myapp'] })
    expect(Object.keys(result.apps)).toContain('myapp')
    expect(Object.keys(result.apps)).toHaveLength(1)
  })

  it('populates app config from bulk data', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'version') return 'dokku version 0.38.31'
      if (args[0] === 'apps:list') return 'myapp'
      if (args[0] === 'network:list') return ''
      if (args[0] === 'nginx:report') return (
        '=====> myapp nginx information\n' +
        '       Nginx client max body size:   50m\n'
      )
      if (args[0] === 'proxy:report') return (
        '=====> myapp proxy information\n' +
        '       Proxy enabled:                true\n'
      )
      if (args[0] === 'ports:report') return (
        '=====> myapp ports information\n' +
        '       Ports map:                    http:80:3000\n'
      )
      return ''
    })
    runner.check = vi.fn().mockResolvedValue(false)
    stubStrict(runner)
    const result = await runExport(runner, {})
    expect(result.apps['myapp'].nginx).toEqual({ 'client-max-body-size': '50m' })
    expect(result.apps['myapp'].proxy).toEqual({ enabled: true })
    expect(result.apps['myapp'].ports).toEqual(['http:80:3000'])
  })

  it('exports app logs with no logs-, computed- or global- prefixed keys', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn(async (...args: string[]) => {
      if (args[0] === 'version') return 'dokku version 0.38.31'
      if (args[0] === 'apps:list') return 'myapp'
      if (args.join(' ') === 'logs:report myapp --format json') {
        return logsAppJson({ 'max-size': '10m', 'logs-max-size': '10m', 'computed-max-size': '10m', 'logs-computed-max-size': '10m', 'global-vector-image': 'x' })
      }
      return emptyAnswer(...args) ?? ''
    })
    runner.check = vi.fn().mockResolvedValue(false)
    stubStrict(runner)
    const result = await runExport(runner, {})
    expect(result.apps.myapp.logs).toEqual({ 'max-size': '10m' })
  })

  const exportRunner = (domainsReport: string) => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn(async (...args: string[]) => {
      if (args[0] === 'version') return 'dokku version 0.38.31'
      if (args[0] === 'apps:list') return 'myapp'
      if (args.join(' ') === 'domains:report') return domainsReport
      return emptyAnswer(...args) ?? ''
    })
    runner.check = vi.fn().mockResolvedValue(false)
    stubStrict(runner)
    return runner
  }

  it('writes domains: false for an app whose domains are disabled', async () => {
    const result = await runExport(exportRunner(
      '=====> myapp domains information\n       Domains app enabled:          false\n       Domains app vhosts:\n'), {})
    expect(result.apps.myapp.domains).toBe(false)
  })

  it('leaves out an app\'s domains, without failing, when its enabled value is garbled', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await runExport(exportRunner(
      '=====> myapp domains information\n       Domains app enabled:          ???\n       Domains app vhosts:          a.example.com\n'), {})
    warn.mockRestore()
    expect(Object.keys(result.apps)).toContain('myapp')
  })

  it('exports the last stored value of a build arg stored twice, never a joined one', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn(async (...args: string[]) => {
      if (args[0] === 'version') return 'dokku version 0.38.31'
      if (args[0] === 'apps:list') return 'myapp'
      if (args.join(' ') === 'docker-options:report myapp --format json') return JSON.stringify({ 'build-list': ['--build-arg B=2', '--build-arg B=3'] })
      return emptyAnswer(...args) ?? ''
    })
    runner.check = vi.fn().mockResolvedValue(false)
    stubStrict(runner)
    const result = await runExport(runner, {})
    expect(result.apps.myapp.build).toEqual({ args: { B: '3' } })
  })
})
