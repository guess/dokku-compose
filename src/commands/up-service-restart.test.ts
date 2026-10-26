import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { printRestartSummary } from './up.js'

function capture() {
  const lines: string[] = []
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { lines.push(a.join(' ')) })
  return lines
}

describe('service restart record', () => {
  afterEach(() => vi.restoreAllMocks())

  it('keeps one entry per service with its reasons once each, in first-marked order', () => {
    const ctx = createContext(createRunner({ dryRun: true }))
    ctx.needsServiceRestart('postgres', 'db', 'memory')
    ctx.needsServiceRestart('redis', 'cache', 'log-driver')
    ctx.needsServiceRestart('postgres', 'db', 'custom-env')
    ctx.needsServiceRestart('postgres', 'db', 'memory')
    expect([...ctx.serviceRestarts.values()]).toEqual([
      { plugin: 'postgres', service: 'db', reasons: ['memory', 'custom-env'] },
      { plugin: 'redis', service: 'cache', reasons: ['log-driver'] },
    ])
  })

  it('the summary prints stop and start per service with the reasons, apps after', () => {
    const lines = capture()
    const ctx = createContext(createRunner({ dryRun: true }))
    ctx.needsServiceRestart('postgres', 'db', 'memory')
    ctx.needsServiceRestart('postgres', 'db', 'custom-env')
    ctx.needsRestart('myapp', 'db password changed')
    printRestartSummary(ctx)
    expect(lines).toEqual([
      '\n# Services that need a stop and start:',
      'dokku postgres:stop db && dokku postgres:start db  # memory, custom-env',
      '\n# Apps that need a restart or rebuild:',
      'dokku ps:restart myapp  # db password changed',
    ])
  })

  it('a dry run says "would need", and an empty record prints nothing', () => {
    const lines = capture()
    const ctx = createContext(createRunner({ dryRun: true }))
    printRestartSummary(ctx, true)
    expect(lines).toEqual([])
    ctx.needsServiceRestart('redis', 'cache', 'memory')
    printRestartSummary(ctx, true)
    expect(lines).toEqual(['\n# Services that would need a stop and start:', 'dokku redis:stop cache && dokku redis:start cache  # memory'])
  })
})
