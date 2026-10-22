import type { Context } from '../core/context.js'
import type { Config } from '../core/schema.js'
import { maskQuerystring } from '../core/mask.js'
import { logAction, logDone, logWarn } from '../core/logger.js'

/** One `links:` entry: a service name, or a service with options. */
export type LinkEntry = NonNullable<NonNullable<Config['apps'][string]['links']>>[number]

export interface LinkSpec {
  service: string
  alias?: string
  env_var?: string
  querystring?: string
}

export function normalizeLink(entry: LinkEntry): LinkSpec {
  return typeof entry === 'string' ? { service: entry } : entry
}

export function hasLinkOptions(link: LinkSpec): boolean {
  return Boolean(link.alias || link.env_var || link.querystring)
}

export function resolveServicePlugin(
  name: string,
  config: Config
): { plugin: string; config: Record<string, unknown> } | undefined {
  if (config.postgres?.[name]) return { plugin: 'postgres', config: config.postgres[name] }
  if (config.redis?.[name]) return { plugin: 'redis', config: config.redis[name] }
  return undefined
}

function allServices(config: Config): [string, string][] {
  const entries: [string, string][] = []
  for (const name of Object.keys(config.postgres ?? {})) entries.push([name, 'postgres'])
  for (const name of Object.keys(config.redis ?? {})) entries.push([name, 'redis'])
  return entries
}

/** The variable `:link` sets with no options (dokku-postgres, dokku-redis 2.3.1 and 2.4.0). */
const DEFAULT_ENV_VAR: Record<string, string> = { postgres: 'DATABASE_URL', redis: 'REDIS_URL' }

/**
 * The app env var a link's URL lands in: `--env-var` as given, `--alias` plus
 * `_URL`, else the plugin default. The one place that knows this mapping;
 * the undeclared-env notes reuse it to skip keys that links inject.
 */
export function linkEnvVar(plugin: string, link: LinkSpec): string {
  if (link.env_var) return link.env_var
  if (link.alias) return `${link.alias}_URL`
  return DEFAULT_ENV_VAR[plugin] ?? `${plugin.toUpperCase()}_URL`
}

/** The `:link` options a spec declares, in command-line form. */
export function linkFlags(link: LinkSpec): string[] {
  const flags: string[] = []
  if (link.alias) flags.push('--alias', link.alias)
  if (link.env_var) flags.push('--env-var', link.env_var)
  if (link.querystring) flags.push('--querystring', link.querystring)
  return flags
}

export type LinkOptionState =
  | { state: 'same' }
  | { state: 'differs'; current: string; desired: string }
  | { state: 'unreadable'; reason: string }

/** One app's env, read once per run by whoever passes the cache. */
export type EnvCache = Map<string, Promise<Record<string, unknown>>>

/** An app's `config:export`, read once per cache. */
export function readEnv(ctx: Context, app: string, cache?: EnvCache): Promise<Record<string, unknown>> {
  let read = cache?.get(app)
  if (!read) {
    read = ctx.queryStrict('config:export', '--format', 'json', app).then(out => JSON.parse(out) as Record<string, unknown>)
    cache?.set(app, read)
  }
  return read
}

/**
 * The env vars of an app whose URL points at the service: its host is
 * `dokku-<plugin>-<service>`, the container name the plugin links by. A
 * same-named variable set by `env:` or by hand does not match. The one place
 * that identifies a link's variable (the undeclared-env notes reuse it).
 */
export function findLinkVariables(
  env: Record<string, unknown>,
  plugin: string,
  service: string
): { name: string; value: string }[] {
  const host = `dokku-${plugin}-${service}`
  const found: { name: string; value: string }[] = []
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== 'string') continue
    const m = value.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?]*@)?([^:/?]+)/i)
    if (m && m[1] === host) found.push({ name, value })
  }
  return found
}

/**
 * With no alias or env var, `:link` falls back to `DOKKU_<PLUGIN>_<COLOR>_URL`
 * when the default name is already in use (a second link of one plugin, or a
 * hand-set `DATABASE_URL`). That is still a plain link.
 */
function isFallbackName(plugin: string, name: string): boolean {
  return new RegExp(`^DOKKU_${plugin.toUpperCase()}_[A-Z]+_URL$`).test(name)
}

function querystringOf(url: string): string {
  const q = url.indexOf('?')
  return q === -1 ? '' : url.slice(q + 1)
}

function show(name: string, qs: string): string {
  return qs ? `${name}?${maskQuerystring(qs)}` : name
}

/**
 * Compare a linked service's declared options (a plain entry means the
 * plugin default name and no querystring) with the server.
 *
 * `:links` and `:app-links` print names only, so the link's variable is found
 * in the app's env by its URL host (`findLinkVariables`). It must have the
 * declared name and querystring. No such variable, or an env that cannot be
 * read, is `unreadable`: a warning, never drift.
 */
export async function readLinkOptions(
  ctx: Context,
  app: string,
  plugin: string,
  link: LinkSpec,
  cache?: EnvCache
): Promise<LinkOptionState> {
  let env: Record<string, unknown>
  try {
    env = await readEnv(ctx, app, cache)
  } catch (err) {
    return { state: 'unreadable', reason: err instanceof Error ? err.message : String(err) }
  }
  const found = findLinkVariables(env, plugin, link.service)
  if (found.length === 0) {
    return { state: 'unreadable', reason: `no variable of '${app}' points at ${link.service}` }
  }
  const name = linkEnvVar(plugin, link)
  const desired = link.querystring ?? ''
  const plain = !link.alias && !link.env_var
  const hit = found.find(v => v.name === name) ?? (plain ? found.find(v => isFallbackName(plugin, v.name)) : undefined)
  if (!hit) return { state: 'differs', current: show(found[0].name, querystringOf(found[0].value)), desired: show(name, desired) }
  const current = querystringOf(hit.value)
  if (current === desired) return { state: 'same' }
  return { state: 'differs', current: show(name, current), desired: show(name, desired) }
}

/** Every link, relink and unlink passes `--no-restart` and marks the app for the restart list. */
export async function ensureAppLinks(
  ctx: Context,
  app: string,
  desiredLinks: LinkEntry[],
  config: Config
): Promise<void> {
  const desired = new Map(desiredLinks.map(normalizeLink).map(l => [l.service, l]))
  for (const [serviceName, plugin] of allServices(config)) {
    const isLinked = await ctx.check(`${plugin}:linked`, serviceName, app)
    const link = desired.get(serviceName)
    if (link && !isLinked) {
      logAction(app, `Linking ${serviceName}`)
      await ctx.run(`${plugin}:link`, serviceName, app, '--no-restart', ...linkFlags(link))
      ctx.needsRestart(app, 'links')
      logDone()
    } else if (link && isLinked) {
      const opts = await readLinkOptions(ctx, app, plugin, link)
      if (opts.state === 'differs') {
        // The plugin refuses a name already set, so unlink (which unsets it) first.
        logAction(app, `Relinking ${serviceName}`)
        await ctx.run(`${plugin}:unlink`, serviceName, app, '--no-restart')
        try {
          await ctx.run(`${plugin}:link`, serviceName, app, '--no-restart', ...linkFlags(link))
        } catch (err) {
          logWarn(app, `${app} is now unlinked from ${serviceName}`)
          throw err
        }
        ctx.needsRestart(app, 'links')
        logDone()
      }
    } else if (!link && isLinked) {
      logAction(app, `Unlinking ${serviceName}`)
      await ctx.run(`${plugin}:unlink`, serviceName, app, '--no-restart')
      ctx.needsRestart(app, 'links')
      logDone()
    }
  }
}

export async function destroyAppLinks(
  ctx: Context,
  app: string,
  links: LinkEntry[],
  config: Config
): Promise<void> {
  for (const serviceName of links.map(l => normalizeLink(l).service)) {
    const resolved = resolveServicePlugin(serviceName, config)
    if (!resolved) continue
    const isLinked = await ctx.check(`${resolved.plugin}:linked`, serviceName, app)
    if (isLinked) {
      await ctx.run(`${resolved.plugin}:unlink`, serviceName, app, '--no-restart')
    }
  }
}

export async function exportAppLinks(
  ctx: Context,
  app: string,
  config: Config
): Promise<LinkEntry[]> {
  const linked: LinkEntry[] = []
  for (const [serviceName, plugin] of allServices(config)) {
    if (!(await ctx.check(`${plugin}:linked`, serviceName, app))) continue
    let found: { name: string; value: string }[] = []
    try {
      found = findLinkVariables(await readEnv(ctx, app), plugin, serviceName)
    } catch { /* unreadable: export the plain name */ }
    const fallback = linkEnvVar(plugin, { service: serviceName })
    const v = found.find(f => f.name === fallback) ?? found.find(f => isFallbackName(plugin, f.name)) ?? found[0]
    if (!v) { linked.push(serviceName); continue }
    const querystring = querystringOf(v.value)
    if ((v.name === fallback || isFallbackName(plugin, v.name)) && !querystring) { linked.push(serviceName); continue }
    const entry: LinkSpec = { service: serviceName }
    if (v.name !== fallback && !isFallbackName(plugin, v.name)) {
      if (v.name.endsWith('_URL') && v.name.length > 4) entry.alias = v.name.slice(0, -4)
      else entry.env_var = v.name
    }
    if (querystring) entry.querystring = querystring
    linked.push(entry)
  }
  return linked
}
