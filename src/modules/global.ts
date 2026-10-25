import type { Context } from '../core/context.js'
import type { AppConfig } from '../core/schema.js'
import { parseJsonReport } from '../resources/parsers.js'
import { logAction, logDone, logSkip, logWarn } from '../core/logger.js'
import { NGINX_KEYS, LOGS_GLOBAL_KEYS } from '../resources/properties.js'

// The top-level blocks that are Dokku's own `--global` settings. Each key lists
// the command that sets it and the report that prints it, so one engine reads,
// applies, prunes and diffs them all.
// Key sets are Dokku 0.38.31's `GlobalProperties` maps; `src/tests/property-keys.test.ts`
// compares them with real `<ns>:report --global` output.

/** How a declared value is written and compared. */
export type GlobalKind =
  /** A string, number or boolean, compared as its string form. */
  | 'scalar'
  /** A list of names, passed as separate arguments and compared without order; `[]` or `false` clears it. */
  | 'list'
  /** A string, or `false` to clear it. */
  | 'clearable'
  /** `true`/`false`: `false` also matches an unset value, as per app. */
  | 'flag'

export interface GlobalKey {
  /** The key in the compose file. */
  yaml: string
  /** The command: `<cmd> --global <key> <value>`. */
  cmd: string
  /** Dokku's key for the command and for the `global-<key>` entry of the report. */
  key: string
  /** The namespace whose `:report --global --format json` prints it. */
  report: string
  kind: GlobalKind
  /** What a changed value needs on an app that does not set the key itself. */
  effect?: 'restart' | 'rebuild'
  /** Never a removal, never pruned: clearing it could detach a running app from its network. */
  keep?: boolean
}

export interface GlobalSpec {
  /** The top-level key in the compose file, and the `global` section of `diff`. */
  name: GlobalName
  keys: GlobalKey[]
}

export type GlobalName =
  | 'nginx' | 'logs' | 'scheduler' | 'registry' | 'checks' | 'ps' | 'build' | 'network' | 'git'

const same = (name: string, cmd: string, keys: readonly string[], kind: GlobalKind = 'scalar'): GlobalKey[] =>
  keys.map(key => ({ yaml: key, cmd, key, report: name, kind }))

export const REGISTRY_GLOBAL_KEYS = ['image-repo-template', 'push-extra-tags', 'push-on-release', 'server'] as const
export const PS_GLOBAL_KEYS = ['procfile-path', 'restart-policy', 'skip-deploy', 'stop-timeout-seconds'] as const

export const GLOBAL_SPECS: Record<GlobalName, GlobalSpec> = {
  nginx: { name: 'nginx', keys: same('nginx', 'nginx:set', NGINX_KEYS) },
  logs: { name: 'logs', keys: same('logs', 'logs:set', LOGS_GLOBAL_KEYS) },
  scheduler: { name: 'scheduler', keys: same('scheduler', 'scheduler:set', ['selected', 'shell']) },
  registry: { name: 'registry', keys: same('registry', 'registry:set', REGISTRY_GLOBAL_KEYS) },
  checks: { name: 'checks', keys: same('checks', 'checks:set', ['wait-to-retire']) },
  ps: { name: 'ps', keys: same('ps', 'ps:set', PS_GLOBAL_KEYS) },
  build: {
    name: 'build',
    keys: [
      { yaml: 'selected', cmd: 'builder:set', key: 'selected', report: 'builder', kind: 'scalar', effect: 'rebuild' },
      { yaml: 'context', cmd: 'builder:set', key: 'build-dir', report: 'builder', kind: 'scalar', effect: 'rebuild' },
      { yaml: 'skip_cleanup', cmd: 'builder:set', key: 'skip-cleanup', report: 'builder', kind: 'scalar' },
      { yaml: 'dockerfile', cmd: 'builder-dockerfile:set', key: 'dockerfile-path', report: 'builder-dockerfile', kind: 'scalar', effect: 'rebuild' },
      { yaml: 'app_json', cmd: 'app-json:set', key: 'appjson-path', report: 'app-json', kind: 'scalar', effect: 'rebuild' },
    ],
  },
  network: {
    name: 'network',
    keys: [
      { yaml: 'attach_post_create', cmd: 'network:set', key: 'attach-post-create', report: 'network', kind: 'list', effect: 'rebuild' },
      { yaml: 'attach_post_deploy', cmd: 'network:set', key: 'attach-post-deploy', report: 'network', kind: 'list', effect: 'rebuild', keep: true },
      { yaml: 'initial_network', cmd: 'network:set', key: 'initial-network', report: 'network', kind: 'clearable', effect: 'rebuild' },
      { yaml: 'bind_all_interfaces', cmd: 'network:set', key: 'bind-all-interfaces', report: 'network', kind: 'flag', effect: 'restart' },
      { yaml: 'tld', cmd: 'network:set', key: 'tld', report: 'network', kind: 'clearable', effect: 'restart' },
    ],
  },
  git: {
    name: 'git',
    keys: [
      { yaml: 'deploy_branch', cmd: 'git:set', key: 'deploy-branch', report: 'git', kind: 'scalar' },
      { yaml: 'keep_git_dir', cmd: 'git:set', key: 'keep-git-dir', report: 'git', kind: 'scalar' },
      { yaml: 'archive_max_files', cmd: 'git:set', key: 'archive-max-files', report: 'git', kind: 'scalar' },
      { yaml: 'archive_max_size', cmd: 'git:set', key: 'archive-max-size', report: 'git', kind: 'scalar' },
    ],
  },
}

export const GLOBAL_NAMES = Object.keys(GLOBAL_SPECS) as GlobalName[]

/**
 * The order `up` applies the top-level blocks in, after the global domains and env and before
 * any app. `network` is not here: it runs right after the shared `networks:` are created.
 */
export const GLOBAL_UP_ORDER: GlobalName[] = ['logs', 'nginx', 'scheduler', 'registry']

/** The compose-file keys a top-level block takes. */
export const globalYamlKeys = (name: GlobalName): string[] => GLOBAL_SPECS[name].keys.map(k => k.yaml)

/** What a top-level block holds: a map of keys, or (scheduler only) the string shorthand for `selected`. */
export type GlobalBlock = Record<string, unknown> | string

function declaredMap(name: GlobalName, block: GlobalBlock | undefined): Record<string, unknown> {
  if (typeof block === 'string') return name === 'scheduler' ? { selected: block } : {}
  return block ?? {}
}

/**
 * The server's global values for a block, keyed by compose-file name, from
 * `<ns>:report --global --format json` (read strictly: a failed read is an error, never an empty
 * report). Empty values are unset and absent.
 */
export async function readGlobal(ctx: Context, name: GlobalName): Promise<Record<string, string>> {
  const spec = GLOBAL_SPECS[name]
  const byReport = new Map<string, Record<string, string>>()
  for (const report of new Set(spec.keys.map(k => k.report))) {
    byReport.set(report, parseJsonReport(await ctx.queryStrict(`${report}:report`, '--global', '--format', 'json'), 'global'))
  }
  const current: Record<string, string> = {}
  for (const gk of spec.keys) {
    const value = byReport.get(gk.report)![gk.key]
    if (value !== undefined) current[gk.yaml] = value
  }
  return current
}

const words = (value: string | undefined): string[] => (value ?? '').split(/\s+/).filter(Boolean)
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(v => b.includes(v))

interface Wanted {
  /** Arguments after `<cmd> --global <key>`; none clears the value. */
  args: string[]
  inSync(current: string | undefined): boolean
}

function wanted(gk: GlobalKey, value: unknown): Wanted {
  if (gk.kind === 'list') {
    const names = Array.isArray(value) ? value.map(String) : []
    return { args: names, inSync: current => sameSet(words(current), names) }
  }
  if (gk.kind === 'clearable' && value === false) {
    return { args: [], inSync: current => current === undefined }
  }
  if (gk.kind === 'flag') {
    const on = value === true || value === 'true'
    // `false` matches an unset value, as for an app.
    return { args: [String(on)], inSync: current => (on ? current === 'true' : current !== 'true') }
  }
  return { args: [String(value)], inSync: current => current === String(value) }
}

export interface GlobalPlan {
  /** Declared keys whose server value differs. */
  changes: { gk: GlobalKey; args: string[] }[]
  /** Keys set on the server that the block no longer declares. */
  removals: GlobalKey[]
}

/** What `up` would set and `--prune` would clear, from the server's values (`readGlobal`). */
export function planGlobal(name: GlobalName, block: GlobalBlock | undefined, current: Record<string, string>): GlobalPlan {
  const declared = declaredMap(name, block)
  const keys = GLOBAL_SPECS[name].keys
  const plan: GlobalPlan = { changes: [], removals: [] }
  // Changes follow the order of the file, removals the order of the table.
  for (const yaml of Object.keys(declared)) {
    const gk = keys.find(k => k.yaml === yaml)
    if (!gk || declared[yaml] === undefined) continue
    const want = wanted(gk, declared[yaml])
    if (!want.inSync(current[yaml])) plan.changes.push({ gk, args: want.args })
  }
  for (const gk of keys) {
    if (!gk.keep && declared[gk.yaml] === undefined && current[gk.yaml] !== undefined) plan.removals.push(gk)
  }
  return plan
}

export interface GlobalOptions {
  /** `up --prune`: also clear the keys the block no longer declares. */
  prune?: boolean
  /** The apps this run processes: a global change that needs a restart or rebuild lists them. */
  apps?: string[]
  /** Their blocks in the file: an app that sets the key itself is unaffected. */
  appConfigs?: Record<string, AppConfig>
}

/** Whether an app's own block in the file sets the key, so a global change does not reach it. */
function appSets(name: GlobalName, gk: GlobalKey, app: AppConfig | undefined): boolean {
  if (name === 'network') {
    if (gk.yaml === 'attach_post_deploy') return app?.networks !== undefined
    return (app?.network as Record<string, unknown> | undefined)?.[gk.yaml] !== undefined
  }
  if (name === 'build') return (app?.build as Record<string, unknown> | undefined)?.[gk.yaml] !== undefined
  return false
}

function markApps(ctx: Context, name: GlobalName, gk: GlobalKey, opts: GlobalOptions): void {
  if (!gk.effect) return
  for (const app of opts.apps ?? []) {
    if (appSets(name, gk, opts.appConfigs?.[app])) continue
    if (gk.effect === 'rebuild') ctx.needsRebuild(app, `global ${name}`)
    else ctx.needsRestart(app, `global ${name}`)
  }
}

/**
 * Applies a top-level block with `<ns>:set --global`: reads the server's values first and sets
 * only the keys that differ. Under `--prune` it also clears each key the declared block no
 * longer lists. A failed read or command throws, which aborts the run (as every global step does).
 * Returns whether anything was set or cleared.
 */
export async function ensureGlobal(
  ctx: Context,
  name: GlobalName,
  block: GlobalBlock | undefined,
  opts: GlobalOptions = {}
): Promise<boolean> {
  logAction('global', `Configuring ${name}`)
  const plan = planGlobal(name, block, await readGlobal(ctx, name))
  for (const { gk, args } of plan.changes) {
    await ctx.run(gk.cmd, '--global', gk.key, ...args)
    markApps(ctx, name, gk, opts)
  }
  if (opts.prune) {
    for (const gk of plan.removals) {
      await ctx.run(gk.cmd, '--global', gk.key)
      markApps(ctx, name, gk, opts)
    }
  }
  const changed = plan.changes.length > 0 || (!!opts.prune && plan.removals.length > 0)
  if (changed) logDone()
  else logSkip()
  if (!opts.prune && plan.removals.length > 0) {
    logWarn('global', `${plan.removals.length} global ${name} setting(s) no longer in the compose file were left on the server; run 'dokku-compose diff' to see them`)
  }
  return changed
}
