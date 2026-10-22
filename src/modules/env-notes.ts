import { findLinkVariables } from './links.js'

const MANAGED_KEYS_VAR = 'DOKKU_COMPOSE_MANAGED_KEYS'
/** App env Dokku 0.38.31 writes itself outside `DOKKU_*` (git's rev env var, domains' vhost flag). */
const DOKKU_WRITTEN = new Set(['GIT_REV', 'NO_VHOST'])
/** A link URL of a postgres or redis service, declared or not. */
const SERVICE_URL_HOST = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?]*@)?dokku-(?:postgres|redis)-[^:/?]+/i

export interface EnvNote {
  key: string
  label?: 'duplicate of global'
}

export interface UndeclaredEnvInput {
  /** The app's `config:export` (app keys only). */
  env: Record<string, unknown>
  /** Keys of the app's `env:`. */
  declared: string[]
  /** The app's declared links, by plugin. */
  links: { plugin: string; service: string }[]
  /** The app's `env_external:`. */
  external: string[]
  /** The file's top-level `env:`. */
  globalFile: Record<string, unknown>
  /** `config:export --global`. */
  globalServer: Record<string, string>
}

/**
 * The app env keys nothing in the file accounts for, names only. `diff`
 * notes them; `up` never sets, unsets or prunes them.
 */
export function undeclaredEnvKeys(input: UndeclaredEnvInput): EnvNote[] {
  const { env } = input
  const skip = new Set<string>([MANAGED_KEYS_VAR, ...input.declared, ...input.external])
  for (const k of String(env[MANAGED_KEYS_VAR] ?? '').split(',')) if (k) skip.add(k)
  for (const link of input.links) {
    for (const v of findLinkVariables(env, link.plugin, link.service)) skip.add(v.name)
  }
  const notes: EnvNote[] = []
  for (const [key, value] of Object.entries(env)) {
    if (skip.has(key) || DOKKU_WRITTEN.has(key)) continue
    if (key.startsWith('DOKKU_') && key !== 'DOKKU_START_CMD') continue
    if (typeof value === 'string' && SERVICE_URL_HOST.test(value)) continue
    const duplicate = key in input.globalFile && key in input.globalServer && input.globalServer[key] === String(value)
    notes.push(duplicate ? { key, label: 'duplicate of global' } : { key })
  }
  return notes
}
