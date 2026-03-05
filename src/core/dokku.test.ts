// NOTE: This file uses bun:test (not vitest) because bun:test's mock.module()
// is required for module-level ESM mocking of execa. Run with: bun test
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
    const callArgs = mockExecaFn.mock.calls[0][1] as string[]
    const controlMasterIdx = callArgs.indexOf('ControlMaster=auto')
    const controlPathIdx = callArgs.findIndex(a => a.startsWith('ControlPath='))
    const controlPersistIdx = callArgs.indexOf('ControlPersist=60')
    expect(callArgs[controlMasterIdx - 1]).toBe('-o')
    expect(callArgs[controlPathIdx - 1]).toBe('-o')
    expect(callArgs[controlPersistIdx - 1]).toBe('-o')
    expect(controlMasterIdx).toBeGreaterThan(-1)
    expect(controlPathIdx).toBeGreaterThan(-1)
    expect(controlPersistIdx).toBeGreaterThan(-1)
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

describe('close() with no host', () => {
  beforeEach(() => {
    mockExecaFn.mockClear()
    mockExecaFn.mockImplementation(async () => ({ stdout: '', stderr: '' }))
  })

  it('close() is a no-op when no host is configured', async () => {
    const runner = createRunner({})  // no host
    mockExecaFn.mockClear()
    await runner.close()
    expect(mockExecaFn).not.toHaveBeenCalled()
  })
})

describe('DryRun runner', () => {
  beforeEach(() => {
    mockExecaFn.mockClear()
    mockExecaFn.mockImplementation(async () => ({ stdout: '', stderr: '' }))
  })

  it('records commands without executing', async () => {
    const runner = createRunner({ dryRun: true })
    await runner.run('apps:create', 'myapp')
    expect(runner.dryRunLog).toEqual(['apps:create myapp'])
    expect(mockExecaFn).not.toHaveBeenCalled()
  })

  it('query() executes for real in dry-run', async () => {
    mockExecaFn.mockImplementation(async () => ({ stdout: 'myapp\n', stderr: '' }))
    const runner = createRunner({ dryRun: true })
    const result = await runner.query('apps:list')
    expect(result).toBe('myapp')
    expect(mockExecaFn).toHaveBeenCalled()
  })

  it('check() executes for real in dry-run', async () => {
    const runner = createRunner({ dryRun: true })
    const ok = await runner.check('apps:exists', 'myapp')
    expect(mockExecaFn).toHaveBeenCalled()
  })
})
