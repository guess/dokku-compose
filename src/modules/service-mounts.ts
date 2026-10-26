// A postgres or redis service mounts `volumes:` entries; this turns them into the
// `<host-path>:<container-dir>[:<options>]` specs `<plugin>:mount` and `<plugin>:create --volume` take.
import type { Context } from '../core/context.js'
import type { Config, ServiceMountsConfig } from '../core/schema.js'
import { declaredServiceMounts, defaultPath, isLegacyName } from '../core/volume-rules.js'
import { readEntries } from './volumes.js'

/** The host path of a declared entry: its `path:`, else the default location. A `legacy-` entry's is on the server. */
async function entryHostPaths(ctx: Context, volumes: Config['volumes'], names: string[]): Promise<Map<string, string>> {
  const paths = new Map<string, string>()
  let server: Awaited<ReturnType<typeof readEntries>> | undefined
  for (const name of names) {
    const declared = volumes?.[name]
    if (declared === undefined) throw new Error(`entry '${name}' is not declared under volumes:`)
    if (isLegacyName(name)) {
      server ??= await readEntries(ctx)
      const hostPath = server.get(name)?.host_path
      if (!hostPath) throw new Error(`entry '${name}' is not on the server, so its host path is unknown`)
      paths.set(name, hostPath)
    } else {
      paths.set(name, declared.path ?? defaultPath(name))
    }
  }
  return paths
}

/**
 * The resolved specs of a service's `mounts:`: `<host-path>:<container-dir>[:ro,<options>]`.
 * undefined when the service declares no `mounts:`. `failedEntries` are the entries `up` could not
 * converge (name -> reason): a service that mounts one cannot be mounted.
 */
export async function resolveServiceMounts(
  ctx: Context,
  volumes: Config['volumes'],
  mounts: ServiceMountsConfig | undefined,
  failedEntries?: Map<string, string>,
): Promise<string[] | undefined> {
  if (mounts === undefined) return undefined
  const declared = declaredServiceMounts(mounts)
  for (const m of declared) {
    const reason = failedEntries?.get(m.entry)
    if (reason !== undefined) throw new Error(`entry '${m.entry}' failed: ${reason}`)
  }
  const paths = await entryHostPaths(ctx, volumes, [...new Set(declared.map(m => m.entry))])
  return declared.map(m => {
    const tokens = [...(m.readonly ? ['ro'] : []), ...m.options]
    return `${paths.get(m.entry)}:${m.container_dir}${tokens.length ? `:${tokens.join(',')}` : ''}`
  })
}
