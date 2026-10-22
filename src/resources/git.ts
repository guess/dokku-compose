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
 * only when the file declares them, and `--prune` never resets them. The per-app
 * `archive-max-*` limits are not declarable: Dokku reads only the global value.
 */
const NOT_REMOVABLE = new Set(['deploy_branch', 'source_image', 'rev_env_var'])

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
  removals: (current, desired) =>
    Object.keys(current ?? {}).filter(k => !NOT_REMOVABLE.has(k) && !(desired && k in desired)),
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
