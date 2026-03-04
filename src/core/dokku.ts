import { execa } from 'execa'

export interface RunnerOptions {
  host?: string    // DOKKU_HOST for SSH
  dryRun?: boolean
}

export interface Runner {
  /** Execute a mutation command (logged in dry-run) */
  run(...args: string[]): Promise<void>
  /** Execute a read-only command, returns stdout */
  query(...args: string[]): Promise<string>
  /** Execute a read-only command, returns true if exit 0 */
  check(...args: string[]): Promise<boolean>
  /** In dry-run mode, the list of commands that would have run */
  dryRunLog: string[]
}

export function createRunner(opts: RunnerOptions = {}): Runner {
  const log: string[] = []

  async function execDokku(args: string[]): Promise<{ stdout: string; ok: boolean }> {
    if (opts.host) {
      try {
        const result = await execa('ssh', [`dokku@${opts.host}`, ...args])
        return { stdout: result.stdout, ok: true }
      } catch (e: any) {
        return { stdout: e.stdout ?? '', ok: false }
      }
    } else {
      try {
        const result = await execa('dokku', args)
        return { stdout: result.stdout, ok: true }
      } catch (e: any) {
        return { stdout: e.stdout ?? '', ok: false }
      }
    }
  }

  return {
    dryRunLog: log,

    async run(...args: string[]): Promise<void> {
      if (opts.dryRun) {
        log.push(args.join(' '))
        return
      }
      await execDokku(args)
    },

    async query(...args: string[]): Promise<string> {
      if (opts.dryRun) return ''
      const { stdout } = await execDokku(args)
      return stdout.trim()
    },

    async check(...args: string[]): Promise<boolean> {
      if (opts.dryRun) return false
      const { ok } = await execDokku(args)
      return ok
    },
  }
}
