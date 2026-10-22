// Settings that left the compose file, per resource. Each resource reports only
// its settable keys; read-only report lines must never come back as removals.
import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { Nginx, Logs, Registry, Scheduler } from './properties.js'
import { Ps } from './ps.js'
import { NetworkProps } from './network.js'
import { Builder } from './builder.js'
import { Checks } from './checks.js'
import { Proxy } from './toggle.js'
import { Config } from './config.js'
import { DockerOptions } from './docker-options.js'
import { readFileSync } from 'node:fs'
import { logsAppJson } from '../tests/fake-server.js'
import { join } from 'node:path'

// Real `<plugin>:report myapp` output from Dokku 0.38.31 (sanitized).
const real = (name: string) =>
  readFileSync(join(import.meta.dirname, '../tests/fixtures/reports', `${name}-report.txt`), 'utf8')

// The same report as `<plugin>:report myapp --format json` prints it.
const realJson = (name: string) =>
  readFileSync(join(import.meta.dirname, '../tests/fixtures/reports', `${name}-report.json`), 'utf8')

function makeCtx(results: Record<string, string>) {
  const runner = createRunner({ dryRun: false })
  const read = async (...args: string[]) => results[args.join(' ')] ?? ''
  runner.query = vi.fn(read)
  runner.queryStrict = vi.fn(read)
  runner.run = vi.fn()
  return createContext(runner)
}

describe('nginx / logs / registry removals', () => {
  const nginxReport = [
    '=====> myapp nginx information',
    '       Nginx client max body size:   50m',
    '       Nginx proxy read timeout:     60s',
    '       Nginx computed client max body size: 50m',
    '       Nginx global hsts:            true',
    '       Nginx some read only line:    yes',
  ].join('\n')

  it('nginx: a settable key set on the box and absent from the file is removed; computed/global/unknown lines never', async () => {
    const ctx = makeCtx({ 'nginx:report myapp': nginxReport })
    const current = await Nginx.read(ctx, 'myapp')
    expect(Nginx.removals!(current, { 'client-max-body-size': '50m' })).toEqual(['proxy-read-timeout'])
    expect(Nginx.removals!(current, undefined)).toEqual(['client-max-body-size', 'proxy-read-timeout'])
  })

  it('nginx: a block that lists every box key has no removals', async () => {
    const current = await Nginx.read(makeCtx({ 'nginx:report myapp': nginxReport }), 'myapp')
    expect(Nginx.removals!(current, { 'client-max-body-size': '1m', 'proxy-read-timeout': '1s' })).toEqual([])
  })

  it('logs: only settable keys', async () => {
    const ctx = makeCtx({
      'logs:report myapp --format json': JSON.stringify({ 'max-size': '10m', 'computed-max-size': '10m', 'vector-sink': 'console://', 'read-only': 'x' }),
    })
    const current = await Logs.read(ctx, 'myapp')
    expect(Logs.removals!(current, { 'max-size': '10m' })).toEqual(['vector-sink'])
  })

  it('registry: only settable keys', async () => {
    const ctx = makeCtx({
      'registry:report myapp': '       Registry server: ghcr.io\n       Registry global server: docker.io\n       Registry tag version: 12\n',
    })
    const current = await Registry.read(ctx, 'myapp')
    expect(Registry.removals!(current, undefined)).toEqual(['server'])
  })

  it('nginx: keys only on the box do not make the block "changed" for up', async () => {
    const { computeAdditiveChange } = await import('../core/change.js')
    expect(Nginx.additive).toBe(true)
    expect(computeAdditiveChange({ 'proxy-read-timeout': '60s' }, {}).changed).toBe(false)
  })
})

describe('scheduler removals', () => {
  it('a selected scheduler absent from the file is removed; an unset one (computed/global only) is not', async () => {
    const set = makeCtx({ 'scheduler:report myapp': '       Scheduler selected: docker-local\n' })
    expect(Scheduler.removals!(await Scheduler.read(set, 'myapp'), undefined)).toEqual(['scheduler'])
    const unset = makeCtx({ 'scheduler:report myapp': '       Scheduler computed selected: docker-local\n       Scheduler global selected: docker-local\n       Scheduler selected:\n' })
    expect(Scheduler.removals!(await Scheduler.read(unset, 'myapp'), undefined)).toEqual([])
  })

  it('a declared scheduler is never a removal', () => {
    expect(Scheduler.removals!('docker-local', 'k3s')).toEqual([])
  })
})

describe('ps removals', () => {
  const report = JSON.stringify({
    'restart-policy': 'on-failure:5',
    'stop-timeout-seconds': '30',
    'computed-restart-policy': 'on-failure:5',
    'global-restart-policy': 'on-failure:10',
    deployed: 'true',
    running: 'true',
    'status-web-1': 'running',
  })

  it('reports allowlisted keys missing from the file, never computed/global/read-only keys', async () => {
    const current = await Ps.read(makeCtx({ 'ps:report myapp --format json': report }), 'myapp')
    expect(Ps.removals!(current, { 'restart-policy': 'always' })).toEqual(['stop-timeout-seconds'])
    expect(Ps.removals!(current, undefined)).toEqual(['restart-policy', 'stop-timeout-seconds'])
  })
})

describe('network properties removals', () => {
  it('reports settable keys only; other report lines never', async () => {
    const ctx = makeCtx({
      'network:report myapp':
        '       Network attach post create: net-a\n       Network tld: internal\n       Network web listeners: 172.17.0.2:5000\n       Network computed tld: internal\n       Network bind all interfaces: false\n',
    })
    const current = await NetworkProps.read(ctx, 'myapp')
    expect(NetworkProps.removals!(current, { tld: 'internal' })).toEqual(['attach_post_create'])
    expect(NetworkProps.removals!(current, undefined)).toEqual(['attach_post_create', 'tld'])
  })
})

describe('build args removals', () => {
  const reports = {
    'builder:report myapp': '       Builder build dir: apps/x\n       Builder detected: dockerfile\n',
    'docker-options:report myapp --format json': JSON.stringify({ 'build-list': ['--build-arg A=1', '--build-arg B=2', '--link x:y'], 'deploy-list': ['--shm-size 1g'] }),
  }

  it('a --build-arg whose KEY is not in build.args is removed; other build options never', async () => {
    const current = await Builder.read(makeCtx(reports), 'myapp')
    expect(Builder.removals!(current, { args: { A: '1' } })).toEqual(['args.B'])
    expect(Builder.removals!(current, undefined)).toEqual(['args.A', 'args.B'])
    expect(Builder.removals!(current, { dockerfile: 'Dockerfile' })).toEqual(['args.A', 'args.B'])
  })
})

describe('checks removals', () => {
  it('real report with nothing set: "none" lists and computed/global lines are not settings', async () => {
    const current = await Checks.read(makeCtx({ 'checks:report myapp': real('checks') }), 'myapp')
    expect(current).toEqual({})
    expect(Checks.removals!(current, undefined)).toEqual([])
  })

  it('reports disabled/skipped lists and wait-to-retire set on the box', async () => {
    const ctx = makeCtx({
      'checks:report myapp':
        '       Checks computed wait to retire: 60\n       Checks disabled list:           web\n       Checks skipped list:            none\n       Checks wait to retire:          30\n',
    })
    const current = await Checks.read(ctx, 'myapp')
    expect(current).toEqual({ disabled: 'web', 'wait-to-retire': '30' })
    expect(Checks.removals!(current, { disabled: ['web'] })).toEqual(['wait-to-retire'])
    expect(Checks.removals!(current, undefined)).toEqual(['disabled', 'wait-to-retire'])
    expect(Checks.removals!(current, false)).toEqual([])
    const all = await Checks.read(makeCtx({ 'checks:report myapp': '       Checks disabled list: _all_\n' }), 'myapp')
    expect(Checks.removals!(all, undefined)).toEqual([])
  })
})

describe('real Dokku 0.38 reports', () => {
  it('nginx: only client-max-body-size and the x-forwarded values are settings; last-visited-at, computed and global never', async () => {
    const current = await Nginx.read(makeCtx({ 'nginx:report myapp': real('nginx') }), 'myapp')
    expect(Nginx.removals!(current, undefined)).toEqual([
      'client-max-body-size', 'x-forwarded-for-value', 'x-forwarded-proto-value',
    ])
    expect(Nginx.removals!(current, { 'client-max-body-size': '100m' })).toEqual(['x-forwarded-for-value', 'x-forwarded-proto-value'])
  })

  it('nginx allowlist covers disable-custom-config and proxy-keepalive, not last-visited-at', () => {
    const set = ['disable-custom-config', 'proxy-keepalive', 'last-visited-at']
    const cur = Object.fromEntries(set.map(k => [k, 'x']))
    expect(Nginx.removals!(cur as any, undefined)).toEqual(['disable-custom-config', 'proxy-keepalive'])
  })

  it('logs, registry, scheduler, builder: an unset real report has no removals', async () => {
    expect(Logs.removals!(await Logs.read(makeCtx({ 'logs:report myapp --format json': realJson('logs') }), 'myapp'), undefined)).toEqual([])
    expect(Registry.removals!(await Registry.read(makeCtx({ 'registry:report myapp': real('registry') }), 'myapp'), undefined)).toEqual([])
    expect(Scheduler.removals!(await Scheduler.read(makeCtx({ 'scheduler:report myapp': real('scheduler') }), 'myapp'), undefined)).toEqual([])
    const b = await Builder.read(makeCtx({ 'builder:report myapp': real('builder') }), 'myapp')
    expect(Builder.removals!(b, undefined)).toEqual([])
  })

  it('logs: the real json report keys only settable app keys, never logs-/computed-/global- ones', async () => {
    const current = await Logs.read(makeCtx({ 'logs:report myapp --format json': logsAppJson({
      'max-size': '10m', 'logs-max-size': '10m', 'computed-max-size': '10m', 'logs-computed-max-size': '10m', 'global-max-size': '50m',
    }) }), 'myapp')
    expect(current).toEqual({ 'max-size': '10m' })
  })

  it('logs and registry allowlists include the real vector-cron-sink and image-repo-template, not tag-version; auth-servers is report-only', () => {
    expect(Logs.removals!({ 'vector-cron-sink': 'x' } as any, undefined)).toEqual(['vector-cron-sink'])
    expect(Registry.removals!({ 'auth-servers': 'x', 'image-repo-template': 'y', 'tag-version': '1' } as any, undefined))
      .toEqual(['image-repo-template'])
  })

  it('network: attach-post-create is the only setting in the real report; listeners and attach-post-deploy never', async () => {
    const current = await NetworkProps.read(makeCtx({ 'network:report myapp': real('network') }), 'myapp')
    expect(current).toEqual({ attach_post_create: ['app-net'] })
    expect(NetworkProps.removals!(current, undefined)).toEqual(['attach_post_create'])
  })
})

describe('proxy removals', () => {
  it('has none: "Proxy enabled" is read-only report state, never a removal', async () => {
    expect(Proxy.removals).toBeUndefined()
    expect(await Proxy.read(makeCtx({ 'proxy:report myapp --proxy-enabled': 'true' }), 'myapp')).toBe(true)
  })
})

describe('env and docker options removals', () => {
  it('env: managed keys gone from the file, including when env: is absent', () => {
    expect(Config.removals!({ A: '1', B: '2' }, { A: '1' })).toEqual(['B'])
    expect(Config.removals!({ A: '1' }, undefined)).toEqual(['A'])
  })

  it('docker options: entries only on the box inside a declared block; a missing block is not shown', () => {
    expect(DockerOptions.removals!({ deploy: ['--a', '--b'], run: ['--r'] }, { deploy: ['--a'] }))
      .toEqual(['deploy: --b', 'run: --r'])
    expect(DockerOptions.removals!({ deploy: ['--a'] }, undefined)).toEqual([])
  })
})
