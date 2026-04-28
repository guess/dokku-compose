import type { Context } from '../core/context.js'
import { logWarn } from '../core/logger.js'

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

export async function ensureDokkuVersion(
  ctx: Context,
  pinned: string | undefined
): Promise<void> {
  if (!pinned) return

  const output = await ctx.query('version')
  const server = extractServerVersion(output)
  if (!server) {
    throw new Error(`Cannot parse Dokku server version from output: ${output}`)
  }

  if (compareSemver(server, pinned) === -1) {
    logWarn(
      'dokku',
      `server is v${server} but dokku-compose.yml pins >= v${pinned}. Some features may be unavailable.`
    )
  }
}
