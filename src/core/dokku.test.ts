// NOTE: This file uses bun:test (not vitest) because bun:test's mock.module()
// is required for module-level ESM mocking of execa. Run with: bun test
import { describe, it, expect, beforeEach, mock } from 'bun:test'

// Mock the execa module before any imports that use it
const mockExecaFn = mock(async (..._args: any[]) => ({ stdout: '', stderr: '' }))

mock.module('execa', () => ({
  execa: mockExecaFn,
}))

// Import after mocking so the module sees the mock
const { createRunner, DokkuCommandError } = await import('./dokku.js')

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

  it('passes plain args to SSH unquoted', async () => {
    const runner = createRunner({ host: 'myserver.com' })
    mockExecaFn.mockClear()
    await runner.query('git:report', 'myapp', '--git-deploy-branch')
    const callArgs = mockExecaFn.mock.calls[0][1] as string[]
    // dokku 0.36's SSH wrapper rejects literal-quoted args for some commands
    // (notably git:report). Plain identifiers and flags must be passed as-is.
    expect(callArgs).toContain('git:report')
    expect(callArgs).toContain('myapp')
    expect(callArgs).toContain('--git-deploy-branch')
    expect(callArgs).not.toContain("'git:report'")
  })

  it('shell-quotes only args containing whitespace or special chars', async () => {
    const runner = createRunner({ host: 'myserver.com' })
    mockExecaFn.mockClear()
    await runner.run('cron:set', 'myapp', '--schedule', '0 5 * * *')
    const callArgs = mockExecaFn.mock.calls[0][1] as string[]
    // Plain args stay unquoted; the schedule (with spaces) gets single-quoted
    // so the remote shell parses it as one arg.
    expect(callArgs).toContain('cron:set')
    expect(callArgs).toContain('myapp')
    expect(callArgs).toContain('--schedule')
    expect(callArgs).toContain("'0 5 * * *'")
  })

  it('a quoted docker option reaches the remote shell as one argument, local exec passes it untouched', async () => {
    const opt = "--build-arg 'URL=https://x?a=1&b=it'\\''s'"
    const ssh = createRunner({ host: 'myserver.com' })
    mockExecaFn.mockClear()
    await ssh.run('docker-options:add', 'myapp', 'build', opt)
    // The remote shell strips one level of quoting, leaving the stored text Dokku shell-splits itself.
    expect((mockExecaFn.mock.calls[0][1] as string[]).at(-1)).toBe(String.raw`'--build-arg '\''URL=https://x?a=1&b=it'\''\'\'''\''s'\'''`)
    const local = createRunner({})
    mockExecaFn.mockClear()
    await local.run('docker-options:add', 'myapp', 'build', opt)
    expect(mockExecaFn.mock.calls[0][1]).toEqual(['docker-options:add', 'myapp', 'build', opt])
  })

  it('passes stdin: ignore over SSH — regression for bash-plugin reports returning empty', async () => {
    // On a real Dokku box, execa's default stdin:'pipe' makes bash-plugin
    // commands (nginx:report, certs:report, postgres:create, ...) silently
    // exit 0 with empty stdout, while Go-plugin commands are unaffected.
    // stdin:'ignore' reproduces the working inherit/interactive behaviour.
    const runner = createRunner({ host: 'myserver.com' })
    mockExecaFn.mockClear()
    await runner.query('nginx:report')
    const callOpts = mockExecaFn.mock.calls[0][2] as any
    expect(callOpts).toEqual({ stdin: 'ignore' })
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
      expect.arrayContaining(['-O', 'exit']),
      expect.objectContaining({ stdin: 'ignore' })
    )
  })
})

describe('createRunner without host (local dokku)', () => {
  beforeEach(() => {
    mockExecaFn.mockClear()
    mockExecaFn.mockImplementation(async () => ({ stdout: '', stderr: '' }))
  })

  it('passes stdin: ignore to the local dokku call', async () => {
    const runner = createRunner({})
    await runner.query('nginx:report')
    expect(mockExecaFn).toHaveBeenCalledWith('dokku', ['nginx:report'], { stdin: 'ignore' })
  })
})

describe('run() surfacing failures', () => {
  beforeEach(() => {
    mockExecaFn.mockClear()
  })

  it('rejects with a DokkuCommandError carrying the command and stderr on non-zero exit', async () => {
    mockExecaFn.mockImplementation(async () => {
      const err: any = new Error('command failed')
      err.stdout = ''
      err.stderr = 'app not found'
      err.exitCode = 1
      throw err
    })
    const runner = createRunner({})
    await expect(runner.run('apps:create', 'myapp')).rejects.toThrow(DokkuCommandError)
    await expect(runner.run('apps:create', 'myapp')).rejects.toThrow(/apps:create myapp/)
    await expect(runner.run('apps:create', 'myapp')).rejects.toThrow(/app not found/)
  })

  it('does not throw when the command succeeds', async () => {
    mockExecaFn.mockImplementation(async () => ({ stdout: '', stderr: '', exitCode: 0 }))
    const runner = createRunner({})
    await expect(runner.run('apps:create', 'myapp')).resolves.toBeUndefined()
  })

  it('masks sensitive args in the thrown error message', async () => {
    mockExecaFn.mockImplementation(async () => {
      const err: any = new Error('command failed')
      err.stdout = ''
      err.stderr = 'boom'
      err.exitCode = 1
      throw err
    })
    const runner = createRunner({})
    await expect(
      runner.run('config:set', 'myapp', 'API_TOKEN=supersecretvalue')
    ).rejects.toThrow(/API_TOKEN=\*\*\*\*alue/)
  })

  it('masks positional backup-auth credentials in the thrown error message', async () => {
    mockExecaFn.mockImplementation(async () => {
      const err: any = new Error('command failed')
      err.stdout = ''
      err.stderr = 'boom'
      err.exitCode = 1
      throw err
    })
    const runner = createRunner({})
    let message = ''
    try {
      await runner.run(
        'postgres:backup-auth', 'mydb',
        'AKIAIOSFODNN7EXAMPLE', 'wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY',
        'us-east-1', 'v4', 's3.amazonaws.com'
      )
    } catch (e: any) {
      message = e.message
    }
    expect(message).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(message).not.toContain('wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY')
    expect(message).toContain('****MPLE')
    expect(message).toContain('****EKEY')
  })

  it('masks a secret echoed back in dokku stderr', async () => {
    mockExecaFn.mockImplementation(async () => {
      const err: any = new Error('command failed')
      err.stdout = ''
      err.stderr = 'invalid access key AKIAIOSFODNN7EXAMPLE for region us-east-1'
      err.exitCode = 1
      throw err
    })
    const runner = createRunner({})
    let message = ''
    try {
      await runner.run(
        'postgres:backup-auth', 'mydb',
        'AKIAIOSFODNN7EXAMPLE', 'wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY',
        'us-east-1', 'v4', 's3.amazonaws.com'
      )
    } catch (e: any) {
      message = e.message
    }
    expect(message).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(message).toContain('****MPLE')
  })

  it('check() returns false on non-zero exit instead of throwing', async () => {
    mockExecaFn.mockImplementation(async () => {
      const err: any = new Error('command failed')
      err.stdout = ''
      err.stderr = ''
      err.exitCode = 1
      throw err
    })
    const runner = createRunner({})
    await expect(runner.check('postgres:exists', 'myapp-postgres')).resolves.toBe(false)
  })

  it('query() stays lenient and returns trimmed stdout even on non-zero exit', async () => {
    mockExecaFn.mockImplementation(async () => {
      const err: any = new Error('command failed')
      err.stdout = ''
      err.stderr = 'no such key'
      err.exitCode = 1
      throw err
    })
    const runner = createRunner({})
    await expect(runner.query('config:get', 'myapp', 'MISSING_KEY')).resolves.toBe('')
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
