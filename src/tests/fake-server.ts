// A fake Dokku server for tests: answers reads from fixed tables and records
// every mutation. Reads it was not given throw, so a test sees each command
// the code under test asks for instead of a silent empty answer.
import { vi } from 'vitest'
import { createRunner, type Runner } from '../core/dokku.js'
import { createContext, type Context } from '../core/context.js'

export interface FakeServer {
  /** `query`/`queryStrict` answers, keyed by the space-joined arguments. */
  queries: Record<string, string>
  /** `check` answers, keyed the same way. */
  checks: Record<string, boolean>
}

/** One app's section of a Dokku stdout report, as `<ns>:report <app>` prints it. */
export function report(app: string, title: string, rows: Record<string, string>): string {
  const lines = [`=====> ${app} ${title} information`]
  for (const [key, value] of Object.entries(rows)) lines.push(`       ${key}:`.padEnd(40) + value)
  return lines.join('\n') + '\n'
}

/**
 * A dry-run runner whose reads come from `server`. Mutations land in
 * `runner.dryRunLog` (and `ctx.commands`) and never reach a real Dokku.
 */
export function fakeContext(server: FakeServer): { ctx: Context; runner: Runner } {
  const runner = createRunner({ dryRun: true })
  const answer = async (...args: string[]) => {
    const key = args.join(' ')
    if (key in server.queries) return server.queries[key]
    throw new Error(`fake server: no answer for 'dokku ${key}'`)
  }
  runner.query = vi.fn(answer)
  runner.queryStrict = vi.fn(answer)
  runner.check = vi.fn(async (...args: string[]) => {
    const key = args.join(' ')
    if (key in server.checks) return server.checks[key]
    throw new Error(`fake server: no check answer for 'dokku ${key}'`)
  })
  return { ctx: createContext(runner), runner }
}

/**
 * What a real Dokku answers for an app or box with nothing set, for the reads
 * that never come back empty: an empty answer to these means the read failed,
 * which dokku-compose treats as unknown. `undefined` for any other read.
 */
export function emptyAnswer(...args: string[]): string | undefined {
  const key = args.join(' ')
  if (/^certs:report \S+ --ssl-enabled$/.test(key)) return 'false'
  if (/^(logs|nginx):report \S+ --format json$/.test(key)) return '{}'
  if (/^checks:report \S+$/.test(key)) return '       Checks disabled list: none\n       Checks skipped list: none\n'
  return undefined
}
