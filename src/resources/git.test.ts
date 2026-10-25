import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { Git } from './git.js'

describe('Git.readAll (bulk)', () => {
  function makeCtx(queryResult: string) {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue(queryResult)
    runner.run = vi.fn()
    return createContext(runner)
  }

  it('returns per-app git config from bulk report', async () => {
    const ctx = makeCtx(
      '=====> app1 git information\n' +
      '       Git deploy branch:            develop\n' +
      '=====> app2 git information\n' +
      '       Git deploy branch:            main\n'
    )
    const result = await Git.readAll!(ctx)
    expect(result.get('app1')).toEqual({ deploy_branch: 'develop' })
    expect(result.get('app2')).toEqual({ deploy_branch: 'main' })
  })

  it('returns undefined deploy_branch when not set', async () => {
    const ctx = makeCtx(
      '=====> app1 git information\n' +
      '       Git deploy branch:            \n'
    )
    const result = await Git.readAll!(ctx)
    expect(result.get('app1')).toEqual({ deploy_branch: undefined })
  })
})

describe('Git.removals: a per-app deploy-branch the top-level git: also declares', () => {
  const removals = Git.removals!
  const copy = { deploy_branch: 'main', keep_git_dir: 'true', source_image: 'web:1', rev_env_var: 'GIT_REV' }

  it('is a removal when it equals the top-level one and the app does not declare its own', () => {
    expect(removals(copy, undefined, { deploy_branch: 'main' })).toEqual(['deploy_branch', 'keep_git_dir'])
    expect(removals(copy, { keep_git_dir: true }, { deploy_branch: 'main' })).toEqual(['deploy_branch'])
  })

  it('is an override when it differs, and never a removal without a top-level deploy_branch', () => {
    expect(removals(copy, undefined, { deploy_branch: 'release' })).toEqual(['keep_git_dir'])
    expect(removals(copy, undefined, { keep_git_dir: true })).toEqual(['keep_git_dir'])
    expect(removals(copy, undefined, undefined)).toEqual(['keep_git_dir'])
  })

  it('is not a removal when the app declares deploy_branch itself', () => {
    expect(removals(copy, { deploy_branch: 'main' }, { deploy_branch: 'main' })).toEqual(['keep_git_dir'])
  })

  it('never lists source-image or rev-env-var', () => {
    expect(removals({ source_image: 'x', rev_env_var: 'R' }, undefined, { deploy_branch: 'main' })).toEqual([])
  })
})
