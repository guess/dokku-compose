import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { runExport } from './export.js'

describe('runExport', () => {
  it('includes dokku version from version command', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'version') return 'dokku version 0.34.5'
      if (args[0] === 'apps:list') return ''
      if (args[0] === 'network:list') return ''
      return ''
    })
    runner.check = vi.fn().mockResolvedValue(false)
    const result = await runExport(runner, {})
    expect(result.dokku).toEqual({ version: '0.34.5' })
  })

  it('includes app names from apps:list', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'apps:list') return 'myapp'
      if (args[0] === 'network:list') return ''
      return ''
    })
    runner.check = vi.fn().mockResolvedValue(false)
    const result = await runExport(runner, {})
    expect(Object.keys(result.apps)).toContain('myapp')
  })

  it('respects appFilter', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
    runner.check = vi.fn().mockResolvedValue(false)
    const result = await runExport(runner, { appFilter: ['myapp'] })
    expect(Object.keys(result.apps)).toContain('myapp')
    expect(Object.keys(result.apps)).toHaveLength(1)
  })
})
