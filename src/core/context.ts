import type { Runner } from './dokku.js'

export interface Context {
  /** Cached read-only query — same args return cached result */
  query(...args: string[]): Promise<string>
  /** Uncached read that throws on a non-zero exit instead of returning empty output */
  queryStrict(...args: string[]): Promise<string>
  /** Boolean check — delegates to runner, not cached */
  check(...args: string[]): Promise<boolean>
  /** Exit code of a read (uncached); `input` goes to stdin, never the command line */
  status(args: string[], input?: string): Promise<number>
  /** Mutation with `input` on stdin; records the command without the input */
  runWithInput(input: string, ...args: string[]): Promise<void>
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
  /**
   * Like `needsRestart`, for a change only a rebuild applies (`dokku ps:rebuild <app>`,
   * which also restarts). Build settings and network attach settings.
   */
  needsRebuild(app: string, reason: string): void
  /**
   * Record that a datastore service needs `dokku <plugin>:stop <svc> && dokku <plugin>:start <svc>`
   * for a change `up` just applied (a property the container reads only when it is made).
   * Call it after the mutating command succeeded; never for a service created in the same run.
   */
  needsServiceRestart(plugin: string, service: string, reason: string): void
  /** `<plugin>:<service>` -> reasons recorded by `needsServiceRestart`, in the order services were first marked */
  serviceRestarts: Map<string, { plugin: string; service: string; reasons: string[] }>
  /** App -> reasons recorded by `needsRebuild` */
  rebuilds: Map<string, string[]>
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
  const rebuilds = new Map<string, string[]>()
  const serviceRestarts = new Map<string, { plugin: string; service: string; reasons: string[] }>()

  return {
    commands,
    runner,
    restarts,
    rebuilds,
    serviceRestarts,

    needsServiceRestart(plugin: string, service: string, reason: string): void {
      const key = `${plugin}:${service}`
      const entry = serviceRestarts.get(key) ?? { plugin, service, reasons: [] }
      if (!entry.reasons.includes(reason)) entry.reasons.push(reason)
      serviceRestarts.set(key, entry)
    },

    needsRebuild(app: string, reason: string): void {
      const reasons = rebuilds.get(app) ?? []
      if (!reasons.includes(reason)) reasons.push(reason)
      rebuilds.set(app, reasons)
    },

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

    status(args: string[], input?: string): Promise<number> {
      return runner.status(args, input)
    },

    async runWithInput(input: string, ...args: string[]): Promise<void> {
      commands.push(args)
      await runner.runWithInput(input, ...args)
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
