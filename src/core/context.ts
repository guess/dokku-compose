import type { Runner } from './dokku.js'

export interface Context {
  /** Cached read-only query — same args return cached result */
  query(...args: string[]): Promise<string>
  /** Uncached read that throws on a non-zero exit instead of returning empty output */
  queryStrict(...args: string[]): Promise<string>
  /** Boolean check — delegates to runner, not cached */
  check(...args: string[]): Promise<boolean>
  /** Mutation — records command, executes via runner */
  run(...args: string[]): Promise<void>
  /** All commands that were run (or would be in dry-run) */
  commands: string[][]
  /**
   * Record that `app` needs `dokku ps:restart <app>` for a change `up` just
   * applied (a setting Dokku only reads when a container starts). Call it
   * after the mutating command succeeded; `reason` is a short label such as
   * `env` or `storage`. Changes Dokku applies live must not call it. The
   * summary `up` prints at the end comes from this record.
   */
  needsRestart(app: string, reason: string): void
  /** App -> reasons recorded by `needsRestart`, in the order apps were first marked */
  restarts: Map<string, string[]>
  /** The underlying runner (for backward compat during migration) */
  runner: Runner
  /** Close the underlying SSH connection */
  close(): Promise<void>
}

export function createContext(runner: Runner): Context {
  const cache = new Map<string, Promise<string>>()
  const commands: string[][] = []
  const restarts = new Map<string, string[]>()

  return {
    commands,
    runner,
    restarts,

    needsRestart(app: string, reason: string): void {
      const reasons = restarts.get(app) ?? []
      if (!reasons.includes(reason)) reasons.push(reason)
      restarts.set(app, reasons)
    },

    query(...args: string[]): Promise<string> {
      const key = args.join('\0')
      if (!cache.has(key)) {
        cache.set(key, runner.query(...args))
      }
      return cache.get(key)!
    },

    queryStrict(...args: string[]): Promise<string> {
      return runner.queryStrict(...args)
    },

    check(...args: string[]): Promise<boolean> {
      return runner.check(...args)
    },

    async run(...args: string[]): Promise<void> {
      commands.push(args)
      await runner.run(...args)
    },

    close(): Promise<void> {
      return runner.close()
    },
  }
}
