import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { runExport } from './export.js'
import { emptyAnswer, logsAppJson, globalReportJson, nginxGlobalJson } from '../tests/fake-server.js'
import { ConfigSchema } from '../core/schema.js'

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
      if (args[0] === 'version') return 'dokku version 0.38.32'
      return ''
    })
    runner.check = vi.fn().mockResolvedValue(false)
    stubStrict(runner)
    const result = await runExport(runner, {})
    expect(result.dokku).toEqual({ version: '0.38.32' })
  })

  it('uses bulk report queries (no app arg) for resources', async () => {
    const runner = createRunner({ dryRun: false })
    const queryCalls: string[][] = []
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      queryCalls.push(args)
      if (args[0] === 'apps:list') return 'myapp'
      if (args[0] === 'version') return 'dokku version 0.38.32'
      return ''
    })
    runner.check = vi.fn().mockResolvedValue(false)
    stubStrict(runner)
    await runExport(runner, {})
    // Should call bulk reports without app arg
    const bulkCalls = queryCalls.filter(
      c => c[0].endsWith(':report') && c.length === 1 && c[0] !== 'apps:report' && c[0] !== 'ps:report'
    )
    // Should have bulk calls for: nginx, registry, scheduler, proxy, ports, domains, network, git, builder
    expect(bulkCalls.length).toBeGreaterThanOrEqual(9)
    // Should NOT have per-app report calls, except those with no bulk read: ps reads per-app JSON,
    // build settings read per app (build-list only exists in the per-app docker-options JSON),
    // logs reads per-app JSON (the bulk report redacts sinks), certs reads the installed certificate, and storage reads per-app JSON (the bulk JSON report is concatenated objects).
    const perApp = ['apps:report', 'ps:report', 'builder:report', 'builder-dockerfile:report', 'app-json:report', 'docker-options:report', 'logs:report', 'certs:report', 'storage:report']
    const perAppReportCalls = queryCalls.filter(
      c => c[0].endsWith(':report') && c.length >= 2 && !perApp.includes(c[0]) && !c.includes('--global')
    )
    expect(perAppReportCalls).toEqual([])
  })

  it('respects appFilter', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn(async (...args: string[]) => args[0] === 'version' ? 'dokku version 0.38.32' : '')
    runner.check = vi.fn().mockResolvedValue(false)
    stubStrict(runner)
    const result = await runExport(runner, { appFilter: ['myapp'] })
    expect(Object.keys(result.apps)).toContain('myapp')
    expect(Object.keys(result.apps)).toHaveLength(1)
  })

  it('populates app config from bulk data', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'version') return 'dokku version 0.38.32'
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
      if (args[0] === 'version') return 'dokku version 0.38.32'
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
      if (args[0] === 'version') return 'dokku version 0.38.32'
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
      if (args[0] === 'version') return 'dokku version 0.38.32'
      if (args[0] === 'apps:list') return 'myapp'
      if (args.join(' ') === 'docker-options:report myapp --format json') return JSON.stringify({ 'build-list': ['--build-arg B=2', '--build-arg B=3'] })
      return emptyAnswer(...args) ?? ''
    })
    runner.check = vi.fn().mockResolvedValue(false)
    stubStrict(runner)
    const result = await runExport(runner, {})
    expect(result.apps.myapp.build).toEqual({ args: { B: '3' } })
  })

  describe('global settings', () => {
    function globalRunner(answers: Record<string, string>) {
      const runner = createRunner({ dryRun: false })
      runner.query = vi.fn(async (...args: string[]) => {
        if (args[0] === 'version') return 'dokku version 0.38.31'
        if (args[0] === 'apps:list') return 'myapp'
        return answers[args.join(' ')] ?? emptyAnswer(...args) ?? ''
      })
      runner.check = vi.fn().mockResolvedValue(false)
      stubStrict(runner)
      return runner
    }

    it('writes each top-level block that holds a value on the server, with typed values', async () => {
      const result = await runExport(globalRunner({
        'scheduler:report --global --format json': globalReportJson('scheduler', { selected: 'docker-local' }),
        'registry:report --global --format json': globalReportJson('registry', { server: 'registry.example.com', 'push-on-release': 'true', 'auth-servers': 'registry.example.com' }),
        'checks:report --global --format json': globalReportJson('checks', { 'wait-to-retire': '30' }),
        'ps:report --global --format json': globalReportJson('ps', { 'restart-policy': 'on-failure:5', 'skip-deploy': 'false' }),
        'builder:report --global --format json': globalReportJson('builder', { selected: 'dockerfile', 'skip-cleanup': 'true' }),
        'builder-dockerfile:report --global --format json': globalReportJson('builder-dockerfile', { 'dockerfile-path': 'Dockerfile' }),
        'network:report --global --format json': globalReportJson('network', { 'attach-post-deploy': 'backend-net worker-net', 'bind-all-interfaces': 'false', tld: 'internal' }),
        'proxy:report --global --format json': globalReportJson('proxy', { type: 'nginx', 'proxy-port': '80' }),
        'git:report --global --format json': globalReportJson('git', { 'deploy-branch': 'main', 'keep-git-dir': 'true', 'archive-max-files': '20000' }),
        'nginx:report --global --format json': nginxGlobalJson({ 'global-client-max-body-size': '50m' }),
      }), {})
      expect(result.scheduler).toBe('docker-local')
      expect(result.registry).toEqual({ 'push-on-release': true, server: 'registry.example.com' })
      expect(result.checks).toEqual({ 'wait-to-retire': '30' })
      expect(result.ps).toEqual({ 'restart-policy': 'on-failure:5', 'skip-deploy': false })
      expect(result.build).toEqual({ selected: 'dockerfile', skip_cleanup: true, dockerfile: 'Dockerfile' })
      expect(result.network).toEqual({ attach_post_deploy: ['backend-net', 'worker-net'], bind_all_interfaces: false, tld: 'internal' })
      expect(result.proxy).toEqual({ type: 'nginx', proxy_port: '80' })
      expect(result.git).toEqual({ deploy_branch: 'main', keep_git_dir: true, archive_max_files: '20000' })
      expect(result.nginx).toEqual({ 'client-max-body-size': '50m' })
      expect(result.logs).toBeUndefined()
      // What export writes, validate and up read back.
      expect(() => ConfigSchema.parse(result)).not.toThrow()
    })

    it('a scheduler with a shell is a map', async () => {
      const result = await runExport(globalRunner({
        'scheduler:report --global --format json': globalReportJson('scheduler', { selected: 'docker-local', shell: 'bash' }),
      }), {})
      expect(result.scheduler).toEqual({ selected: 'docker-local', shell: 'bash' })
    })

    it('leaves out a block whose report cannot be read, with a warning, and exports the rest', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const result = await runExport(globalRunner({
          'scheduler:report --global --format json': 'not json',
          'checks:report --global --format json': globalReportJson('checks', { 'wait-to-retire': '30' }),
        }), {})
        expect(result.scheduler).toBeUndefined()
        expect(result.checks).toEqual({ 'wait-to-retire': '30' })
        expect(warn.mock.calls.map(c => String(c[0])).join('\n')).toContain("could not read 'scheduler'")
      } finally {
        warn.mockRestore()
      }
    })
  })
})
