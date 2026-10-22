import { describe, it, expect, vi } from 'vitest'
import { createRunner, DokkuCommandError } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { reconcile } from '../core/reconcile.js'
import { Certs } from './certs.js'

const CERTFILE = 'src/tests/fixtures/certs/myapp.crt'
const KEYFILE = 'src/tests/fixtures/certs/myapp.key'
const DECLARED = { certfile: CERTFILE, keyfile: KEYFILE }
// The fixture's certificate, as `certs:show myapp crt` prints it (a trailing newline more).
const SAME_CRT = '-----BEGIN CERTIFICATE-----\nTUlJQmZha2VDZXJ0aWZpY2F0ZUZvclRlc3RzT25seQ==\n-----END CERTIFICATE-----\n\n'
const OTHER_CRT = '-----BEGIN CERTIFICATE-----\nT3RoZXJDZXJ0\n-----END CERTIFICATE-----\n'

function setup(enabled: string, show: () => Promise<string>) {
  const runner = createRunner({ dryRun: false })
  runner.query = vi.fn(async (...args: string[]) => {
    if (args.join(' ') === 'certs:report myapp --ssl-enabled') return enabled
    throw new Error(`unexpected query ${args.join(' ')}`)
  })
  runner.queryStrict = vi.fn(async (...args: string[]) => {
    if (args.join(' ') === 'certs:show myapp crt') return show()
    throw new Error(`unexpected strict query ${args.join(' ')}`)
  })
  runner.run = vi.fn()
  return createContext(runner)
}

describe('Certs', () => {
  it('the same certificate (trailing whitespace aside) runs no cert write', async () => {
    const ctx = setup('true', async () => SAME_CRT)
    await reconcile(Certs, ctx, 'myapp', DECLARED)
    expect(ctx.commands).toEqual([])
  })

  it('a changed certificate runs certs:update', async () => {
    const ctx = setup('true', async () => OTHER_CRT)
    await reconcile(Certs, ctx, 'myapp', DECLARED)
    expect(ctx.commands).toEqual([['certs:update', 'myapp', CERTFILE, KEYFILE]])
  })

  it('no certificate runs certs:add', async () => {
    const ctx = setup('false', async () => { throw new Error('never read') })
    await reconcile(Certs, ctx, 'myapp', DECLARED)
    expect(ctx.commands).toEqual([['certs:add', 'myapp', CERTFILE, KEYFILE]])
  })

  it('certs:show saying the app has no SSL endpoint means no cert: certs:add', async () => {
    const ctx = setup('true', async () => {
      throw new DokkuCommandError(['certs:show', 'myapp', 'crt'], 1, " !     myapp doesn't have an SSL endpoint defined")
    })
    await reconcile(Certs, ctx, 'myapp', DECLARED)
    expect(ctx.commands).toEqual([['certs:add', 'myapp', CERTFILE, KEYFILE]])
  })

  it('an unreadable cert is unknown: an error, and no cert write', async () => {
    for (const ctx of [
      setup('', async () => SAME_CRT),
      setup('true', async () => { throw new DokkuCommandError(['certs:show', 'myapp', 'crt'], 1, 'ssh: connection refused') }),
    ]) {
      await expect(reconcile(Certs, ctx, 'myapp', DECLARED)).rejects.toThrow('could not read the installed certificate')
      expect(ctx.commands).toEqual([])
    }
  })

  it('ssl: false removes an installed cert, and does nothing when there is none', async () => {
    const installed = setup('true', async () => SAME_CRT)
    await reconcile(Certs, installed, 'myapp', false)
    expect(installed.commands).toEqual([['certs:remove', 'myapp']])
    const none = setup('false', async () => SAME_CRT)
    await reconcile(Certs, none, 'myapp', false)
    expect(none.commands).toEqual([])
  })

  it('never reads the key', async () => {
    const ctx = setup('true', async () => OTHER_CRT)
    await reconcile(Certs, ctx, 'myapp', DECLARED)
    const reads = [...(ctx.runner.query as any).mock.calls, ...(ctx.runner.queryStrict as any).mock.calls]
    expect(reads.flat()).not.toContain('key')
  })
})
