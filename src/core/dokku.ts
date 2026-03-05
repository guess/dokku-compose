import { execa } from 'execa'
import { createHash } from 'crypto'
import * as os from 'os'
import * as path from 'path'

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
  /** Close the SSH control socket (no-op if not using SSH) */
  close(): Promise<void>
}

export function createRunner(opts: RunnerOptions = {}): Runner {
  const log: string[] = []

  // SSH ControlMaster socket path — one per host.
  // Hash the hostname so the path is always a fixed short length and stays
  // well under macOS UNIX_PATH_MAX (104 chars): "dc-" + 16 hex chars + ".sock" = 24 chars.
  const controlPath = opts.host
    ? path.join(os.tmpdir(), `dc-${createHash('sha1').update(opts.host).digest('hex').slice(0, 16)}.sock`)
    : null

  const sshControlFlags = controlPath
    ? ['-o', 'ControlMaster=auto', '-o', `ControlPath=${controlPath}`, '-o', 'ControlPersist=60']
    : []

  function shellQuote(arg: string): string {
    return `'${arg.replace(/'/g, "'\\''")}'`
  }

  async function execDokku(args: string[]): Promise<{ stdout: string; ok: boolean }> {
    if (opts.host) {
      try {
        const result = await execa('ssh', [...sshControlFlags, `dokku@${opts.host}`, '--', ...args.map(shellQuote)])
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
        log.push(args.map(a => a.includes(' ') ? shellQuote(a) : a).join(' '))
        return
      }
      await execDokku(args)
    },

    async query(...args: string[]): Promise<string> {
      const { stdout } = await execDokku(args)
      return stdout.trim()
    },

    async check(...args: string[]): Promise<boolean> {
      const { ok } = await execDokku(args)
      return ok
    },

    async close(): Promise<void> {
      if (!opts.host || !controlPath) return
      try {
        await execa('ssh', ['-O', 'exit', '-o', `ControlPath=${controlPath}`, `dokku@${opts.host}`])
      } catch {
        // Socket may not exist yet (e.g. dry-run or no commands ran) — ignore
      }
    },
  }
}
