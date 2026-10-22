import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { reconcile } from '../core/reconcile.js'
import { Checks } from './checks.js'

function setup(report: string) {
  const runner = createRunner({ dryRun: false })
  runner.query = vi.fn(async () => report)
  runner.run = vi.fn()
  return createContext(runner)
}
const BOX = [
  '       Checks disabled list: web,worker',
  '       Checks skipped list: api',
  '       Checks wait to retire: 30',
].join('\n')

describe('Checks --prune', () => {
  it('enables only the stale types and resets wait-to-retire; applies the declared state first and never re-disables', async () => {
    const ctx = setup(BOX)
    await reconcile(Checks, ctx, 'myapp', { disabled: ['web', 'worker'] }, undefined, true)
    expect(ctx.commands).toEqual([
      ['checks:disable', 'myapp', 'web', 'worker'],
      ['checks:enable', 'myapp', 'api'],
      ['checks:set', 'myapp', 'wait-to-retire'],
    ])
  })

  it('a type declared in the file and in an undeclared box list is left, with a warning naming the manual command', async () => {
    const ctx = setup('       Checks disabled list: none\n       Checks skipped list: web\n')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await reconcile(Checks, ctx, 'myapp', { disabled: ['web'] }, undefined, true)
    expect(ctx.commands.some(c => c[0] === 'checks:enable')).toBe(false)
    expect(warn.mock.calls.flat().join('')).toContain("dokku checks:enable myapp web")
    warn.mockRestore()
  })

  it('a block gone from the file enables every stale type once; without prune nothing; checks: false has no removals', async () => {
    const ctx = setup(BOX)
    await reconcile(Checks, ctx, 'myapp', undefined, undefined, true)
    expect(ctx.commands).toEqual([
      ['checks:enable', 'myapp', 'web', 'worker', 'api'],
      ['checks:set', 'myapp', 'wait-to-retire'],
    ])
    const none = setup(BOX)
    await reconcile(Checks, none, 'myapp', undefined)
    expect(none.commands).toEqual([])
    const off = setup(BOX)
    await reconcile(Checks, off, 'myapp', false, undefined, true)
    expect(off.commands).toEqual([['checks:disable', 'myapp']])
  })

  it('an empty read resets nothing', async () => {
    const ctx = setup('')
    await reconcile(Checks, ctx, 'myapp', undefined, undefined, true)
    expect(ctx.commands).toEqual([])
  })
})
