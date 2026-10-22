import type { Resource } from '../core/reconcile.js'
import type { Context } from '../core/context.js'
import { parseReport, parseBulkReport } from './parsers.js'

type DockerOpts = { build?: string[]; deploy?: string[]; run?: string[] }

const PHASES = ['build', 'deploy', 'run'] as const

// These are managed by other resources (services, builder) — filter them out
function filterManagedOpts(opts: string[]): string[] {
  return opts.filter(o => !o.startsWith('--link ') && !o.startsWith('--build-arg '))
}

function parsePhaseOpts(raw: string): string[] {
  if (!raw) return []
  // Options are space-separated but may contain values with spaces (e.g. "--shm-size 256m")
  // Split on " --" boundaries, keeping the "--" prefix
  const opts = raw.match(/--\S+(?:\s+(?!--)\S+)*/g) ?? []
  return filterManagedOpts(opts)
}

function dockerOptsFromReport(report: Record<string, string>): DockerOpts {
  const result: DockerOpts = {}
  for (const phase of PHASES) {
    const opts = parsePhaseOpts(report[phase] ?? '')
    if (opts.length > 0) result[phase] = opts
  }
  return result
}

export const DockerOptions: Resource<DockerOpts> = {
  key: 'docker_options',
  // Pruned by `up` within a declared block only, so a missing block is not shown.
  removals: (current, desired) => !desired ? [] :
    PHASES.flatMap(phase => {
      const wanted = new Set(desired?.[phase] ?? [])
      return (current?.[phase] ?? []).filter(o => !wanted.has(o)).map(o => `${phase}: ${o}`)
    }),

  async read(ctx: Context, target: string): Promise<DockerOpts> {
    const raw = await ctx.query('docker-options:report', target)
    return dockerOptsFromReport(parseReport(raw, 'docker-options'))
  },

  async readAll(ctx: Context): Promise<Map<string, DockerOpts>> {
    const raw = await ctx.query('docker-options:report')
    const bulk = parseBulkReport(raw, 'docker-options')
    const result = new Map<string, DockerOpts>()
    for (const [app, report] of bulk) {
      result.set(app, dockerOptsFromReport(report))
    }
    return result
  },

  // Dokku: options "only apply to containers created after the options have been
  // modified" (docs/advanced-usage/docker-options.md, v0.38.31), so deploy and
  // run options need a restart. Build options are read only by a build, which
  // a restart does not run, so they need `ps:rebuild`.
  async onChange(ctx: Context, target: string, { before, after }: { before: DockerOpts; after: DockerOpts }): Promise<void> {
    for (const phase of PHASES) {
      const prev = new Set(before[phase] ?? [])
      const desired = new Set(after[phase] ?? [])
      for (const opt of desired) {
        if (!prev.has(opt)) {
          await ctx.run('docker-options:add', target, phase, opt)
          if (phase === 'build') ctx.needsRebuild(target, 'build options')
          else ctx.needsRestart(target, 'docker_options')
        }
      }
      for (const opt of prev) {
        if (!desired.has(opt)) {
          await ctx.run('docker-options:remove', target, phase, opt)
          if (phase === 'build') ctx.needsRebuild(target, 'build options')
          else ctx.needsRestart(target, 'docker_options')
        }
      }
    }
  },
}
