import type { Resource } from '../core/reconcile.js'
import type { MapChange } from '../core/change.js'
import type { Context } from '../core/context.js'
import { parseReport } from './parsers.js'

/** Every `git:set` key (Dokku 0.38.31 `plugins/git/subcommands/set`). */
export const GIT_KEYS = [
  'archive-max-files', 'archive-max-size', 'deploy-branch', 'keep-git-dir', 'rev-env-var', 'source-image',
] as const

type GitConfig = {
  deploy_branch?: string
  keep_git_dir?: string | boolean
  rev_env_var?: string
  source_image?: string
  archive_max_files?: string | number
  archive_max_size?: string | number
}

/** Schema key (underscored) to Dokku key (hyphenated). */
const toDokku = (key: string) => key.replaceAll('_', '-')

/**
 * Keys `git:report` cannot show as set per app, so they never count as removals:
 * `rev-env-var` prints its default `GIT_REV` when unset, and `archive-max-*` have
 * only a computed value, which is read to compare a declared value.
 */
const NOT_REMOVABLE = new Set(['rev_env_var', 'archive_max_files', 'archive_max_size'])

function fromReport(report: Record<string, string>): GitConfig {
  const config: GitConfig = {}
  if (report['deploy-branch']) config.deploy_branch = report['deploy-branch']
  if (report['keep-git-dir']) config.keep_git_dir = report['keep-git-dir']
  if (report['rev-env-var']) config.rev_env_var = report['rev-env-var']
  if (report['source-image']) config.source_image = report['source-image']
  // Only the computed value is printed per app: the global one, else Dokku's default.
  const files = report['computed-archive-max-files']
  const size = report['computed-archive-max-size']
  if (files) config.archive_max_files = files
  if (size) config.archive_max_size = size
  return config
}

/** `parseReport` drops computed keys; the two archive limits are only reported that way. */
function parseGitReport(raw: string): Record<string, string> {
  const report = parseReport(raw, 'git')
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*Git computed archive max (files|size):\s*(\S.*)$/)
    if (m) report[`computed-archive-max-${m[1]}`] = m[2].trim()
  }
  return report
}

export const Git: Resource<GitConfig> = {
  key: 'git',
  additive: true,
  removals: (current, desired) =>
    Object.keys(current ?? {}).filter(k => !NOT_REMOVABLE.has(k) && !(desired && k in desired)),
  prune: async (ctx, target, removed) => {
    for (const key of removed) await ctx.run('git:set', target, toDokku(key))
  },
  read: async (ctx, target) => fromReport(parseGitReport(await ctx.query('git:report', target))),
  readAll: async (ctx: Context) => {
    const result = new Map<string, GitConfig>()
    for (const section of (await ctx.query('git:report')).split(/(?=^=====> )/m)) {
      const app = section.match(/^=====> (.+?)\s+git\s+information/i)?.[1]
      if (app) result.set(app, fromReport(parseGitReport(section)))
    }
    return result
  },
  onChange: async (ctx, target, change: MapChange) => {
    for (const [key, value] of Object.entries({ ...change.added, ...change.modified })) {
      await ctx.run('git:set', target, toDokku(key), String(value))
    }
  },
}
