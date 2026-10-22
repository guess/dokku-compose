import { createRequire } from 'module'
import type { Context } from '../core/context.js'
import { logWarn } from '../core/logger.js'

/**
 * The oldest Dokku this dokku-compose supports: the first release where every
 * command it reads as JSON accepts `--format json`.
 *
 * Source (dokku/dokku release notes and tags, checked with `gh api`):
 * - `config:export --format json`: v0.15.5 (#3511)
 * - `ps:report --format json`: v0.23.1 (#4369)
 * - `ps:scale --format json`: v0.38.21 (#8796)
 * - `plugin:list --format json`: v0.38.22 (#8801); v0.38.21's
 *   plugins/plugin/internal-functions has no format handling, v0.38.22's does.
 * So 0.38.22 is the first release with all four.
 */
export const MIN_DOKKU_VERSION = '0.38.22'

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)/

function parseSemver(input: string): [number, number, number] {
  const m = input.match(SEMVER_RE)
  if (!m) throw new Error(`Cannot parse version: ${input}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

export function extractServerVersion(output: string): string | null {
  const match = output.match(/(\d+\.\d+\.\d+)/)
  return match ? match[1] : null
}

export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const [aMaj, aMin, aPatch] = parseSemver(a)
  const [bMaj, bMin, bPatch] = parseSemver(b)
  if (aMaj !== bMaj) return aMaj < bMaj ? -1 : 1
  if (aMin !== bMin) return aMin < bMin ? -1 : 1
  if (aPatch !== bPatch) return aPatch < bPatch ? -1 : 1
  return 0
}

/** dokku-compose's own version: package.json sits one level up from dist/ and two from src/modules/. */
function toolVersion(): string {
  const require = createRequire(import.meta.url)
  for (const p of ['../package.json', '../../package.json']) {
    try {
      return require(p).version as string
    } catch {
      // try the next layout
    }
  }
  return 'unknown'
}

/**
 * Read the server's Dokku version and stop when it is older than
 * MIN_DOKKU_VERSION. Every command that talks to a server calls this first,
 * before any other Dokku call. Returns the server's version.
 */
export async function assertDokkuSupported(ctx: Pick<Context, 'query'>): Promise<string> {
  const output = await ctx.query('version')
  const server = extractServerVersion(output)
  if (!server) {
    throw new Error(`Cannot parse Dokku server version from output: ${output}`)
  }
  if (compareSemver(server, MIN_DOKKU_VERSION) === -1) {
    throw new Error(
      `dokku-compose ${toolVersion()} needs Dokku >= ${MIN_DOKKU_VERSION}; this server runs ${server}. Upgrade Dokku first.`
    )
  }
  return server
}

/** How the server's version relates to the file's `dokku.version`. */
export function compareToFile(server: string, file: string | undefined): 'none' | 'equal' | 'older' | 'newer' {
  if (!file) return 'none'
  const c = compareSemver(server, file)
  return c === 0 ? 'equal' : c < 0 ? 'older' : 'newer'
}

/**
 * `up`: the file's `dokku.version` is a hard minimum, so an older server stops
 * the run before anything changes. A newer server is drift: one notice that does not block.
 */
export function enforceFileVersion(server: string, file: string | undefined): void {
  const rel = compareToFile(server, file)
  if (rel === 'older') {
    throw new Error(`Dokku server is v${server} but the file requires >= v${file}. Upgrade Dokku or lower dokku.version.`)
  }
  if (rel === 'newer') {
    logWarn('dokku', `server is v${server}, newer than dokku.version ${file} in the file; update the file when ready`)
  }
}
