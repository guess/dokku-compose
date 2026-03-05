import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { runExport } from './export.js'

describe('runExport', () => {
  it('includes dokku version from version command', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'version') return 'dokku version 0.34.5'
      return ''
    })
    runner.check = vi.fn().mockResolvedValue(false)
    const result = await runExport(runner, {})
    expect(result.dokku).toEqual({ version: '0.34.5' })
  })

  it('uses bulk report queries (no app arg) for resources', async () => {
    const runner = createRunner({ dryRun: false })
    const queryCalls: string[][] = []
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      queryCalls.push(args)
      if (args[0] === 'apps:list') return 'myapp'
      if (args[0] === 'version') return 'dokku version 0.34.5'
      return ''
    })
    runner.check = vi.fn().mockResolvedValue(false)
    await runExport(runner, {})
    // Should call bulk reports without app arg
    const bulkCalls = queryCalls.filter(
      c => c[0].endsWith(':report') && c.length === 1 && c[0] !== 'apps:report'
    )
    // Should have bulk calls for: nginx, logs, registry, scheduler, proxy, ports, domains, storage, certs, network, git
    expect(bulkCalls.length).toBeGreaterThanOrEqual(10)
    // Should NOT have per-app report calls (except config which has no readAll)
    const perAppReportCalls = queryCalls.filter(
      c => c[0].endsWith(':report') && c.length >= 2 && c[0] !== 'apps:report'
    )
    expect(perAppReportCalls).toEqual([])
  })

  it('respects appFilter', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
    runner.check = vi.fn().mockResolvedValue(false)
    const result = await runExport(runner, { appFilter: ['myapp'] })
    expect(Object.keys(result.apps)).toContain('myapp')
    expect(Object.keys(result.apps)).toHaveLength(1)
  })

  it('populates app config from bulk data', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'version') return 'dokku version 0.34.5'
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
    const result = await runExport(runner, {})
    expect(result.apps['myapp'].nginx).toEqual({ 'client-max-body-size': '50m' })
    expect(result.apps['myapp'].proxy).toEqual({ enabled: true })
    expect(result.apps['myapp'].ports).toEqual(['http:80:3000'])
  })
})
