import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { Certs } from './certs.js'

describe('Certs.readAll (bulk)', () => {
  function makeCtx(queryResult: string) {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue(queryResult)
    runner.run = vi.fn()
    return createContext(runner)
  }

  it('returns per-app booleans from bulk report', async () => {
    const ctx = makeCtx(
      '=====> app1 ssl information\n' +
      '       Ssl enabled:                  true\n' +
      '=====> app2 ssl information\n' +
      '       Ssl enabled:                  false\n'
    )
    const result = await Certs.readAll!(ctx)
    expect(result.get('app1')).toBe(true)
    expect(result.get('app2')).toBe(false)
  })
})
