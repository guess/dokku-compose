import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { ensureAppCerts } from './certs.js'

describe('ensureAppCerts', () => {
  it('adds cert when ssl not enabled', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('false')
    runner.run = vi.fn()
    await ensureAppCerts(runner, 'myapp', { certfile: 'x.crt', keyfile: 'x.key' })
    expect(runner.run).toHaveBeenCalledWith('certs:add', 'myapp', 'x.crt', 'x.key')
  })

  it('skips if ssl already enabled', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('true')
    runner.run = vi.fn()
    await ensureAppCerts(runner, 'myapp', { certfile: 'x.crt', keyfile: 'x.key' })
    expect(runner.run).not.toHaveBeenCalled()
  })

  it('removes cert when ssl: false', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('true')
    runner.run = vi.fn()
    await ensureAppCerts(runner, 'myapp', false)
    expect(runner.run).toHaveBeenCalledWith('certs:remove', 'myapp')
  })
})
