import { describe, it, expect, vi, beforeEach } from 'vitest'
import { execa } from 'execa'

vi.mock('execa')
const mockExeca = vi.mocked(execa)

describe('createRunner with host', () => {
  beforeEach(() => {
    mockExeca.mockResolvedValue({ stdout: '', stderr: '' } as any)
  })

  it('includes ControlMaster flags in SSH args', async () => {
    const { createRunner } = await import('./dokku.js')
    const runner = createRunner({ host: 'myserver.com' })
    await runner.query('apps:list')
    expect(mockExeca).toHaveBeenCalledWith(
      'ssh',
      expect.arrayContaining([
        '-o', 'ControlMaster=auto',
        '-o', expect.stringContaining('ControlPath='),
        '-o', 'ControlPersist=60',
      ])
    )
  })

  it('runner has a close() method', async () => {
    const { createRunner } = await import('./dokku.js')
    const runner = createRunner({ host: 'myserver.com' })
    expect(typeof runner.close).toBe('function')
  })

  it('close() sends ssh -O exit to the control socket', async () => {
    const { createRunner } = await import('./dokku.js')
    const runner = createRunner({ host: 'myserver.com' })
    mockExeca.mockClear()
    await runner.close()
    expect(mockExeca).toHaveBeenCalledWith(
      'ssh',
      expect.arrayContaining(['-O', 'exit'])
    )
  })
})

describe('DryRun runner', () => {
  it('records commands without executing', async () => {
    const { createRunner } = await import('./dokku.js')
    const runner = createRunner({ dryRun: true })
    await runner.run('apps:create', 'myapp')
    expect(runner.dryRunLog).toEqual(['apps:create myapp'])
  })

  it('query() works in dry-run (returns empty string)', async () => {
    const { createRunner } = await import('./dokku.js')
    const runner = createRunner({ dryRun: true })
    const result = await runner.query('apps:exists', 'myapp')
    expect(result).toBe('')
  })

  it('check() returns false in dry-run', async () => {
    const { createRunner } = await import('./dokku.js')
    const runner = createRunner({ dryRun: true })
    const ok = await runner.check('apps:exists', 'myapp')
    expect(ok).toBe(false)
  })
})
