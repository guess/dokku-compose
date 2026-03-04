import { describe, it, expect, beforeEach, mock } from 'bun:test'

// Mock the execa module before any imports that use it
const mockExecaFn = mock(async (..._args: any[]) => ({ stdout: '', stderr: '' }))

mock.module('execa', () => ({
  execa: mockExecaFn,
}))

// Import after mocking so the module sees the mock
const { createRunner } = await import('./dokku.js')

describe('createRunner with host', () => {
  beforeEach(() => {
    mockExecaFn.mockClear()
    mockExecaFn.mockImplementation(async () => ({ stdout: '', stderr: '' }))
  })

  it('includes ControlMaster flags in SSH args', async () => {
    const runner = createRunner({ host: 'myserver.com' })
    await runner.query('apps:list')
    expect(mockExecaFn).toHaveBeenCalledWith(
      'ssh',
      expect.arrayContaining([
        '-o', 'ControlMaster=auto',
        '-o', expect.stringContaining('ControlPath='),
        '-o', 'ControlPersist=60',
      ])
    )
  })

  it('runner has a close() method', () => {
    const runner = createRunner({ host: 'myserver.com' })
    expect(typeof runner.close).toBe('function')
  })

  it('close() sends ssh -O exit to the control socket', async () => {
    const runner = createRunner({ host: 'myserver.com' })
    mockExecaFn.mockClear()
    await runner.close()
    expect(mockExecaFn).toHaveBeenCalledWith(
      'ssh',
      expect.arrayContaining(['-O', 'exit'])
    )
  })
})

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
