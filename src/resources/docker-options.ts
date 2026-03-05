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

  async onChange(ctx: Context, target: string, { after }: { after: DockerOpts }): Promise<void> {
    for (const phase of PHASES) {
      const opts = after[phase]
      if (!opts || opts.length === 0) continue
      await ctx.run('docker-options:clear', target, phase)
      for (const opt of opts) {
        await ctx.run('docker-options:add', target, phase, opt)
      }
    }
  },
}
