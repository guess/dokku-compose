import * as fs from 'fs'
import type { Resource } from '../core/reconcile.js'
import type { Change } from '../core/change.js'
import { DokkuCommandError } from '../core/dokku.js'

type DeclaredSsl = false | true | { certfile: string; keyfile: string }

/**
 * What the server has: `false` (no cert), `{ crt }` (the installed
 * certificate, never the key), or `undefined` when it could not be read,
 * which is unknown and never "no cert".
 */
export type InstalledSsl = false | { crt: string } | undefined

type SslValue = DeclaredSsl | InstalledSsl

// `certs:show` fails with "<app> doesn't have an SSL endpoint defined" when no
// cert is installed (Dokku 0.38.31 plugins/certs/subcommands/show).
const NO_ENDPOINT = "doesn't have an SSL endpoint"

function readCertFile(path: string): string {
  try {
    return fs.readFileSync(path, 'utf8')
  } catch (err) {
    throw new Error(`ssl: cannot read certfile '${path}': ${err instanceof Error ? err.message : String(err)}`)
  }
}

export const Certs: Resource<SslValue> = {
  key: 'ssl',
  read: async (ctx, target): Promise<InstalledSsl> => {
    const enabled = (await ctx.query('certs:report', target, '--ssl-enabled')).trim()
    if (enabled === 'false') return false
    if (enabled !== 'true') return undefined
    try {
      return { crt: await ctx.queryStrict('certs:show', target, 'crt') }
    } catch (err) {
      if (err instanceof DokkuCommandError && err.message.includes(NO_ENDPOINT)) return false
      return undefined
    }
  },
  inSync: (current, desired) => {
    const installed = current as InstalledSsl
    if (installed === undefined) return false
    if (desired === false) return installed === false
    if (desired === true) return installed !== false
    if (installed === false || typeof desired !== 'object' || !('certfile' in desired)) return false
    // Compare the certificate only, ignoring trailing whitespace; the key is never read.
    return installed.crt.trimEnd() === readCertFile(desired.certfile).trimEnd()
  },
  onChange: async (ctx, target, { before, after }: Change<SslValue>) => {
    if (before === undefined) {
      throw new Error('ssl: could not read the installed certificate; left as is')
    }
    if (after === false && before) {
      await ctx.run('certs:remove', target)
    }
    if (after && typeof after === 'object' && 'certfile' in after) {
      await ctx.run(before ? 'certs:update' : 'certs:add', target, after.certfile, after.keyfile)
    }
  },
}
