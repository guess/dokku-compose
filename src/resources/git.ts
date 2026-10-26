import type { Resource } from '../core/reconcile.js'
import type { MapChange } from '../core/change.js'
import type { Context } from '../core/context.js'
import { parseReport } from './parsers.js'

/** Every `git:set` key (Dokku 0.38.31 `plugins/git/subcommands/set`). */
export const GIT_KEYS = ['deploy-branch', 'keep-git-dir', 'rev-env-var', 'source-image'] as const

type GitConfig = {
  deploy_branch?: string
  keep_git_dir?: string | boolean
  rev_env_var?: string
  source_image?: string
}

/** Schema key (underscored) to Dokku key (hyphenated). */
const toDokku = (key: string) => key.replaceAll('_', '-')

/**
 * Keys that are never removals because Dokku writes them itself: `deploy-branch`
 * (on `git:sync` and push), `source-image` (on every `git:from-image`), and
 * `rev-env-var`, which prints its default `GIT_REV` when unset. They are compared
 * only when the file declares them, and `--prune` never resets them, with one exception for
 * `deploy-branch` (see `isCopiedDeployBranch`). The per-app `archive-max-*` limits are not
 * declarable: Dokku reads only the global value.
 */
const NOT_REMOVABLE = new Set(['deploy_branch', 'source_image', 'rev_env_var'])

/**
 * A per-app `deploy-branch` equal to the deploy branch the top-level `git:` declares is a copy
 * of what an older dokku-compose wrote onto every app (the top-level block was a per-app default
 * then): the app would inherit the same value from `git:set --global`, so it is a removal. A
 * different value is a deliberate override and stays. An app that declares its own
 * `deploy_branch` is never asked (the caller skips declared keys).
 */
function isCopiedDeployBranch(current: GitConfig, inherited: { deploy_branch?: string } | undefined): boolean {
  return inherited?.deploy_branch !== undefined && current.deploy_branch === String(inherited.deploy_branch)
}

function fromReport(report: Record<string, string>): GitConfig {
  const config: GitConfig = {}
  if (report['deploy-branch']) config.deploy_branch = report['deploy-branch']
  if (report['keep-git-dir']) config.keep_git_dir = report['keep-git-dir']
  if (report['rev-env-var']) config.rev_env_var = report['rev-env-var']
  if (report['source-image']) config.source_image = report['source-image']
  return config
}

export const Git: Resource<GitConfig> = {
  key: 'git',
  additive: true,
  inheritsGlobal: true,
  removals: (current, desired, inherited) =>
    Object.keys(current ?? {}).filter(k => {
      if (desired && k in desired) return false
      if (k === 'deploy_branch') return isCopiedDeployBranch(current, inherited as { deploy_branch?: string } | undefined)
      return !NOT_REMOVABLE.has(k)
    }),
  prune: async (ctx, target, removed) => {
    for (const key of removed) await ctx.run('git:set', target, toDokku(key))
  },
  read: async (ctx, target) => fromReport(parseReport(await ctx.query('git:report', target), 'git')),
  readAll: async (ctx: Context) => {
    const result = new Map<string, GitConfig>()
    for (const section of (await ctx.query('git:report')).split(/(?=^=====> )/m)) {
      const app = section.match(/^=====> (.+?)\s+git\s+information/i)?.[1]
      if (app) result.set(app, fromReport(parseReport(section, 'git')))
    }
    return result
  },
  onChange: async (ctx, target, change: MapChange) => {
    for (const [key, value] of Object.entries({ ...change.added, ...change.modified })) {
      await ctx.run('git:set', target, toDokku(key), String(value))
    }
  },
}
