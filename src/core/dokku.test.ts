import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRunner } from './dokku.js'

describe('DryRun runner', () => {
  it('records commands without executing', async () => {
    const runner = createRunner({ dryRun: true })
    await runner.run('apps:create', 'myapp')
    expect(runner.dryRunLog).toEqual(['apps:create myapp'])
  })

  it('query() works in dry-run (returns empty string)', async () => {
    const runner = createRunner({ dryRun: true })
    const result = await runner.query('apps:exists', 'myapp')
    expect(result).toBe('')
  })

  it('check() returns false in dry-run', async () => {
    const runner = createRunner({ dryRun: true })
    const ok = await runner.check('apps:exists', 'myapp')
    expect(ok).toBe(false)
  })
})
