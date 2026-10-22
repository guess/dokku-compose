import { execa } from 'execa'
import { createHash } from 'crypto'
import * as os from 'os'
import * as path from 'path'
import { maskSensitiveArgsList, maskSecretsInText } from './mask.js'

export interface RunnerOptions {
  host?: string    // DOKKU_HOST for SSH
  dryRun?: boolean
}

/**
 * Thrown by Runner.run() when a mutation command exits non-zero. Carries the
 * (masked) command line, exit code and a trimmed stderr tail so callers can
 * surface a clear error instead of silently reporting success.
 */
export class DokkuCommandError extends Error {
  constructor(
    public readonly args: string[],
    public readonly exitCode: number,
    public readonly stderr: string
  ) {
    const { masked, secrets } = maskSensitiveArgsList(args)
    const maskedCmd = masked.join(' ')
    // Mask dokku's own stderr too: a command that echoes an argument back
    // (e.g. on validation failure) must not leak the secret it was given.
    const stderrTail = maskSecretsInText(stderr.trim(), secrets)
    super(
      `dokku ${maskedCmd} failed (exit ${exitCode})` +
      (stderrTail ? `: ${stderrTail}` : '')
    )
    this.name = 'DokkuCommandError'
  }
}

export interface Runner {
  /** Execute a mutation command (logged in dry-run) */
  run(...args: string[]): Promise<void>
  /** Execute a read-only command, returns stdout */
  query(...args: string[]): Promise<string>
  /** Like query, but throws DokkuCommandError when the command exits non-zero */
  queryStrict(...args: string[]): Promise<string>
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
    // Only quote args containing shell-significant characters. Wrapping every arg in
    // single quotes confuses the dokku SSH command wrapper (notably git:report on
    // dokku 0.36), which can pass SSH_ORIGINAL_COMMAND through to dokku without
    // stripping the literal quotes for some subcommands.
    if (/^[A-Za-z0-9_\-:.,/=@]+$/.test(arg)) return arg
    return `'${arg.replace(/'/g, "'\\''")}'`
  }

  async function execDokku(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number; ok: boolean }> {
    // stdin must never be inherited as an open pipe: several Dokku bash-plugin
    // commands (nginx:report, certs:report, domains:report, git:report,
    // docker-options:report, builder-dockerfile:*, postgres:create/link, ...)
    // silently do nothing and exit 0 with empty stdout when stdin is a pipe,
    // while Go-plugin commands are unaffected. `stdin: 'ignore'` reproduces the
    // working `stdin: 'inherit'`/interactive-shell behaviour without attaching
    // this process's stdin to the child. No call site here pipes input to
    // dokku/ssh, so this is safe everywhere.
    if (opts.host) {
      try {
        const result = await execa('ssh', [...sshControlFlags, `dokku@${opts.host}`, '--', ...args.map(shellQuote)], { stdin: 'ignore' })
        return { stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? ''), exitCode: result.exitCode ?? 0, ok: true }
      } catch (e: any) {
        return { stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? ''), exitCode: e.exitCode ?? 1, ok: false }
      }
    } else {
      try {
        const result = await execa('dokku', args, { stdin: 'ignore' })
        return { stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? ''), exitCode: result.exitCode ?? 0, ok: true }
      } catch (e: any) {
        return { stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? ''), exitCode: e.exitCode ?? 1, ok: false }
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
      const { ok, exitCode, stderr } = await execDokku(args)
      if (!ok) {
        throw new DokkuCommandError(args, exitCode, stderr)
      }
    },

    async query(...args: string[]): Promise<string> {
      // Lenient by design: callers (e.g. `config:get` of a missing key) rely
      // on a non-zero exit reading back as empty output, not a thrown error.
      const { stdout } = await execDokku(args)
      return stdout.trim()
    },

    async queryStrict(...args: string[]): Promise<string> {
      const { stdout, ok, exitCode, stderr } = await execDokku(args)
      if (!ok) throw new DokkuCommandError(args, exitCode, stderr)
      return stdout.trim()
    },

    async check(...args: string[]): Promise<boolean> {
      const { ok } = await execDokku(args)
      return ok
    },

    async close(): Promise<void> {
      if (!opts.host || !controlPath) return
      try {
        await execa('ssh', ['-O', 'exit', '-o', `ControlPath=${controlPath}`, `dokku@${opts.host}`], { stdin: 'ignore' })
      } catch {
        // Socket may not exist yet (e.g. dry-run or no commands ran) — ignore
      }
    },
  }
}
