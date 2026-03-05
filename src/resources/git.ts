import type { Resource } from '../core/reconcile.js'
import type { Context } from '../core/context.js'
import { parseBulkReport } from './parsers.js'

type GitConfig = { deploy_branch?: string }

export const Git: Resource<GitConfig> = {
  key: 'git',
  read: async (ctx, target) => {
    const report = await ctx.query('git:report', target, '--git-deploy-branch')
    return { deploy_branch: report.trim() || undefined }
  },
  readAll: async (ctx: Context) => {
    const raw = await ctx.query('git:report')
    const bulk = parseBulkReport(raw, 'git')
    const result = new Map<string, GitConfig>()
    for (const [app, report] of bulk) {
      result.set(app, { deploy_branch: report['deploy-branch'] || undefined })
    }
    return result
  },
  onChange: async (ctx, target, { after }: { after: GitConfig }) => {
    if (after.deploy_branch) {
      await ctx.run('git:set', target, 'deploy-branch', after.deploy_branch)
    }
  },
}
