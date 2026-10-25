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

/** The compose-file keys a top-level block takes. */
export const globalYamlKeys = (name: GlobalName): string[] => GLOBAL_SPECS[name].keys.map(k => k.yaml)
