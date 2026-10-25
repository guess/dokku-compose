import { z } from 'zod'
import { SEMVER_RE } from '../modules/version.js'
import { NGINX_KEYS, LOGS_KEYS, LOGS_GLOBAL_KEYS, REGISTRY_KEYS } from '../resources/properties.js'
import {
  entryNameError, isLegacyName, chownError, modeError, pathError, usesDefaultLocation,
  parseMountString, mountIssues, declaredMounts, scopesOverlap, DEFAULT_SCOPE, type MountItem,
} from './volume-rules.js'
import { REGISTRY_GLOBAL_KEYS } from '../modules/global.js'
import { MANAGED_PROPERTIES, rejectedReason, customEnvPairs } from '../modules/service-property-keys.js'

/** A free-form property map that only takes keys Dokku's `<ns>:set` accepts. */
function propertyMap<V extends z.ZodTypeAny>(namespace: string, keys: readonly string[], value: V, scope = '') {
  return z.record(z.string(), value).superRefine((map, ctx) => {
    for (const key of Object.keys(map)) {
      if (!keys.includes(key)) {
        ctx.addIssue({ code: 'custom', path: [key], message: `'${key}' is not a ${namespace}:set${scope} property (valid: ${keys.join(', ')})` })
      }
    }
  })
}
const StringOrNumber = z.union([z.string(), z.number()])

/** Error options for a strict object: a hint for each key it names, Zod's own message for the rest. */
function withHints(hints: Record<string, string>, notAnObject?: (input: unknown) => string | undefined) {
  return {
    error: (iss: any): string | undefined => {
      if (iss.code === 'unrecognized_keys' && (iss.keys as string[]).some(k => k in hints)) {
        return (iss.keys as string[]).map(k => `'${k}' ${hints[k] ?? 'is not a recognized key'}`).join('; ')
      }
      if (iss.code === 'invalid_type' && iss.expected === 'object') return notAnObject?.(iss.input)
      return undefined
    },
  }
}

const PER_APP_ONLY = 'is a per-app setting (Dokku has no global form); put it under apps.<app>'

const PortSchema = z.string().regex(
  /^(http|https|tcp|udp):\d+:\d+$/,
  'Port must be scheme:host:container (e.g. http:80:3000)'
)

const EnvMapSchema = z.union([
  z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  z.literal(false)
])

/** `checks:set wait-to-retire` takes seconds: a whole number, or a quoted one (`"60"`); `true` and `false` are refused. */
const WaitToRetire = z.preprocess(
  v => (typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v),
  z.number({ error: 'wait-to-retire is a number of seconds' }).int().min(0)
)

const ChecksSchema = z.union([
  z.literal(false),
  z.object({
    disabled: z.array(z.string()).optional(),
    skipped: z.array(z.string()).optional(),
    // The only `checks:set` key (Dokku 0.38.31); anything else is refused.
    'wait-to-retire': WaitToRetire.optional(),
  }).strict()
])

const GitSchema = z.object({
  deploy_branch: z.string().optional(),
  keep_git_dir: z.union([z.string(), z.boolean()]).optional(),
  rev_env_var: z.string().optional(),
  source_image: z.string().optional(),
  // Dokku reads `archive-max-files` and `archive-max-size` only from the global setting
  // (`git:set --global`), so a per-app value never applies: declare them in the top-level `git:`.
  archive_max_files: z.any().optional().refine(v => v === undefined, { message: 'archive_max_files is read only from the global git setting; declare it in the top-level git:' }),
  archive_max_size: z.any().optional().refine(v => v === undefined, { message: 'archive_max_size is read only from the global git setting; declare it in the top-level git:' }),
}).strict()

// The top-level `git:` is `git:set --global`: the four keys Dokku reads globally.
const GlobalGitSchema = z.strictObject({
  deploy_branch: z.string().optional(),
  keep_git_dir: z.union([z.string(), z.boolean()]).optional(),
  archive_max_files: StringOrNumber.optional(),
  archive_max_size: StringOrNumber.optional(),
}, withHints({ rev_env_var: `${PER_APP_ONLY}.git`, source_image: `${PER_APP_ONLY}.git` }))

const SchedulerSchema = z.union([z.string(), z.object({ selected: z.string().optional(), shell: z.string().optional() }).strict()])

const PsSchema = z.object({
  'procfile-path': z.union([z.string(), z.number()]).optional(),
  'restart-policy': z.union([z.string(), z.number()]).optional(),
  'stop-timeout-seconds': z.union([z.string(), z.number()]).optional(),
  'dockerfile-start-cmd': z.union([z.string(), z.number()]).optional(),
  restore: z.union([z.string(), z.boolean()]).optional(),
  'skip-deploy': z.union([z.string(), z.boolean()]).optional(),
  'start-cmd': z.union([z.string(), z.number()]).optional(),
}).strict()

const GlobalPsSchema = z.strictObject({
  'procfile-path': z.union([z.string(), z.number()]).optional(),
  'restart-policy': z.union([z.string(), z.number()]).optional(),
  'stop-timeout-seconds': z.union([z.string(), z.number()]).optional(),
  'skip-deploy': z.union([z.string(), z.boolean()]).optional(),
}, withHints(Object.fromEntries(['restore', 'start-cmd', 'dockerfile-start-cmd'].map(k => [k, `${PER_APP_ONLY}.ps`]))))

const GlobalChecksSchema = z.strictObject({
  // The only `checks:set` key (Dokku 0.38.31), and the only one with a global form.
  'wait-to-retire': WaitToRetire.optional(),
}, withHints({
  disabled: `${PER_APP_ONLY}.checks`,
  skipped: `${PER_APP_ONLY}.checks`,
}, input => input === false ? 'false disables the checks of one app; put it under apps.<app>.checks' : undefined))

const BuildSchema = z.object({
  dockerfile: z.string().optional(),
  app_json: z.string().optional(),
  context: z.string().optional(),
  selected: z.string().optional(),
  skip_cleanup: z.union([z.string(), z.boolean()]).optional(),
  args: z.record(z.string(), z.string()).optional(),
}).strict()

const GlobalBuildSchema = z.strictObject({
  dockerfile: z.string().optional(),
  app_json: z.string().optional(),
  context: z.string().optional(),
  selected: z.string().optional(),
  skip_cleanup: z.union([z.string(), z.boolean()]).optional(),
}, withHints({ args: 'has no global form (build args are docker options); put them under apps.<app>.build.args' }))

const NETWORK_LIST_HINT = 'is the list of networks to attach; properties such as tld go under network:'
const NETWORK_PROPS_HINT = 'takes properties (tld, bind_all_interfaces, ...); the list of networks to attach goes under networks:'

const NetworkSchema = z.strictObject({
  attach_post_create: z.union([z.array(z.string()), z.literal(false)]).optional(),
  initial_network: z.union([z.string(), z.literal(false)]).optional(),
  bind_all_interfaces: z.boolean().optional(),
  static_web_listener: z.union([z.string(), z.literal(false)]).optional(),
  tld: z.union([z.string(), z.literal(false)]).optional(),
}, withHints({
  attach_post_deploy: 'is not a network: key; per app, attach-post-deploy is the list under networks:',
  networks: 'is a sibling of network:, not a key inside it',
}, input => Array.isArray(input) ? NETWORK_PROPS_HINT : undefined))

// The top-level `network:` is `network:set --global`; the plural `networks:` stays the list to create.
const GlobalNetworkSchema = z.strictObject({
  attach_post_create: z.union([z.array(z.string()), z.literal(false)]).optional(),
  attach_post_deploy: z.array(z.string()).optional(),
  initial_network: z.union([z.string(), z.literal(false)]).optional(),
  bind_all_interfaces: z.boolean().optional(),
  tld: z.union([z.string(), z.literal(false)]).optional(),
}, withHints({
  static_web_listener: `${PER_APP_ONLY}.network`,
  networks: 'is the list of shared networks to create; it sits beside network:, not inside it',
}, input => Array.isArray(input)
  ? 'takes global properties (tld, attach_post_deploy, ...); the list of shared networks to create goes under networks:'
  : undefined))

// The top-level `proxy:` is `proxy:set --global`; `enabled` (proxy:enable/disable) has no global form.
const GlobalProxySchema = z.strictObject({
  type: z.string().optional(),
  proxy_port: StringOrNumber.optional(),
  proxy_ssl_port: StringOrNumber.optional(),
}, withHints({ enabled: `${PER_APP_ONLY}.proxy` }))

const isMap = (input: unknown) => !!input && typeof input === 'object' && !Array.isArray(input)
const appNetworksList = z.array(z.string(), {
  error: (iss: any) => iss.code === 'invalid_type' && isMap(iss.input) ? NETWORK_LIST_HINT : undefined,
})
const sharedNetworksList = z.array(z.string(), {
  error: (iss: any) => iss.code === 'invalid_type' && isMap(iss.input)
    ? 'is the list of shared networks to create; global network properties go under network:' : undefined,
})

const LinkSchema = z.union([
  z.string(),
  z.object({
    service: z.string(),
    alias: z.string().min(1).optional(),
    env_var: z.string().min(1).optional(),
    querystring: z.string().min(1).optional(),
  }).strict().refine(l => !(l.alias && l.env_var), { message: '`alias` and `env_var` cannot be combined' }),
])

const VolumeSchema = z.object({
  // Checked below, so a wrong type gets a message that says how to write it.
  chown: z.union([z.literal(false), z.string(), z.number()]).optional(),
  mode: z.union([z.string(), z.number()]).optional(),
  path: z.string().optional(),
}).strict()

/** Entries by name. A `legacy-<hash>` name may appear only as `{}`: an entry Dokku made, declared so apps can mount it. */
const VolumesSchema = z.record(z.string(), VolumeSchema).superRefine((volumes, ctx) => {
  const bad = (name: string, key: string | undefined, message: string) =>
    ctx.addIssue({ code: 'custom', path: key ? [name, key] : [name], message })
  for (const [name, v] of Object.entries(volumes)) {
    if (isLegacyName(name)) {
      if (Object.keys(v).length > 0) bad(name, undefined, `'${name}' starts with 'legacy-', which Dokku reserves for entries it made from old host-path mounts: declare such an entry as {}, or give a new entry another name`)
      continue
    }
    const nameError = entryNameError(name)
    if (nameError) bad(name, undefined, nameError)
    if (v.mode !== undefined) { const e = modeError(v.mode); if (e) bad(name, 'mode', e) }
    if (v.chown !== undefined) { const e = chownError(v.chown); if (e) bad(name, 'chown', e) }
    if (v.path !== undefined) {
      const e = pathError(v.path)
      if (e) bad(name, 'path', e)
      else if (!usesDefaultLocation(name, v.path)) {
        // Dokku manages owner and mode only under its default storage location.
        if (v.mode !== undefined) bad(name, 'mode', `mode needs the default location: Dokku refuses it on a custom path. Drop path, or manage '${v.path}' yourself`)
        if (v.chown !== undefined && v.chown !== false) bad(name, 'chown', `chown needs the default location: Dokku refuses it on a custom path. Drop path, use chown: false, or manage '${v.path}' yourself`)
      }
    }
  }
})

const unsupportedMountKey = (key: string) => z.any().optional().refine(v => v === undefined, {
  message: `${key} is not supported: on docker-local Dokku stores it but never applies it`,
})

const MountObjectSchema = z.object({
  entry: z.string().min(1),
  container_dir: z.string().min(1),
  readonly: z.boolean().optional(),
  phases: z.array(z.enum(['deploy', 'run'])).min(1).optional(),
  process_type: z.string().optional(),
  options: z.array(z.string()).optional(),
  subpath: unsupportedMountKey('subpath'),
  volume_chown: unsupportedMountKey('volume_chown'),
}).strict().superRefine((m, ctx) => {
  for (const message of mountIssues(m as MountItem)) ctx.addIssue({ code: 'custom', message })
})

const MountStringSchema = z.string().superRefine((s, ctx) => {
  const parsed = parseMountString(s)
  if (typeof parsed === 'string') ctx.addIssue({ code: 'custom', message: parsed })
  else for (const message of mountIssues(parsed)) ctx.addIssue({ code: 'custom', message })
})

const AppSchema = z.object({
  domains: z.union([z.array(z.string()), z.literal(false)]).optional(),
  links: z.array(LinkSchema).optional(),
  ports: z.array(PortSchema).optional(),
  env: EnvMapSchema.optional(),
  /** App env keys something else sets: names only; `diff` stops noting them. */
  env_external: z.array(z.string().min(1)).optional(),
  ssl: z.union([
    z.literal(false),
    z.literal(true),
    z.object({ certfile: z.string(), keyfile: z.string() }).strict()
  ]).optional(),
  storage: z.array(z.union([MountStringSchema, MountObjectSchema])).optional(),
  proxy: z.object({
    enabled: z.boolean().optional(),
    type: z.string().optional(),
    proxy_port: StringOrNumber.optional(),
    proxy_ssl_port: StringOrNumber.optional(),
  }).strict().optional(),
  networks: appNetworksList.optional(),
  network: NetworkSchema.optional(),
  nginx: propertyMap('nginx', NGINX_KEYS, StringOrNumber).optional(),
  logs: propertyMap('logs', LOGS_KEYS, StringOrNumber).optional(),
  // `auth-servers` is report-only: it is a registry login, not a `registry:set` key.
  registry: propertyMap('registry', REGISTRY_KEYS, z.union([z.string(), z.boolean()])).optional(),
  scheduler: SchedulerSchema.optional(),
  scale: z.record(z.string(), z.preprocess(v => (typeof v === 'string' && /^\s*-?\d+\s*$/.test(v) ? Number(v) : v), z.number().int().min(0))).optional(),
  ps: PsSchema.optional(),
  checks: ChecksSchema.optional(),
  build: BuildSchema.optional(),
  docker_options: z.object({
    build: z.array(z.string()).optional(),
    deploy: z.array(z.string()).optional(),
    run: z.array(z.string()).optional(),
  }).strict().optional(),
  git: GitSchema.optional(),
}).strict()

/** What `export` writes in place of a secret it cannot read back. */
export const EXPORT_PLACEHOLDER = 'REPLACE_ME'

/** A secret the file must really give: not the placeholder `export` wrote. */
const notPlaceholder = (v: string) => v !== EXPORT_PLACEHOLDER
const placeholderMessage = `replace the ${EXPORT_PLACEHOLDER} placeholder written by export`
const singleLine = (v: string) => !/[\r\n]/.test(v)

const ServiceBackupAuthSchema = z.object({
  access_key_id: z.string().min(1).refine(notPlaceholder, placeholderMessage),
  secret_access_key: z.string().min(1).refine(notPlaceholder, placeholderMessage),
  region: z.string().min(1),
  signature_version: z.string().min(1),
  endpoint: z.string().min(1),
}).strict()

// `encryption` names one form: a passphrase, or a GPG public key (with an optional keyserver); false clears it.
const ServiceBackupEncryptionSchema = z.object({
  passphrase: z.string().min(1).refine(singleLine, 'must be a single line').refine(notPlaceholder, placeholderMessage).optional(),
  public_key_id: z.string().min(1).refine(singleLine, 'must be a single line').optional(),
  keyserver: z.string().min(1).refine(singleLine, 'must be a single line').optional(),
}).strict().superRefine((enc, ctx) => {
  if (enc.passphrase !== undefined && enc.public_key_id !== undefined) {
    ctx.addIssue({ code: 'custom', message: 'name passphrase or public_key_id, not both' })
  } else if (enc.passphrase === undefined && enc.public_key_id === undefined) {
    ctx.addIssue({ code: 'custom', message: 'name passphrase or public_key_id (use encryption: false to clear it)' })
  }
  if (enc.keyserver !== undefined && enc.public_key_id === undefined) {
    ctx.addIssue({ code: 'custom', path: ['keyserver'], message: 'keyserver goes with public_key_id' })
  }
})

export const STORAGE_CLASSES = [
  'STANDARD', 'REDUCED_REDUNDANCY', 'STANDARD_IA', 'ONEZONE_IA', 'INTELLIGENT_TIERING', 'GLACIER', 'DEEP_ARCHIVE', 'GLACIER_IR',
] as const

/** The plugin's own rule for `backup-object-name`. */
function objectNameProblem(name: string): string | undefined {
  if (name.length > 512) return 'must be at most 512 characters'
  if (!/^[A-Za-z0-9._\-/]+$/.test(name)) return 'may hold only letters, numbers, dots, dashes, underscores and slashes'
  if (name.startsWith('/') || name.endsWith('/')) return 'must not start or end with a slash'
  if (name.split('/').some(seg => seg === '' || seg === '.' || seg === '..')) return 'must not have an empty, . or .. segment'
  return undefined
}

const ServiceBackupSchema = z.object({
  schedule: z.string().min(1),
  bucket: z.string().min(1),
  auth: ServiceBackupAuthSchema,
  // false clears the service's encryption; absent leaves it alone
  encryption: z.union([ServiceBackupEncryptionSchema, z.literal(false)]).optional(),
  storage_class: z.enum(STORAGE_CLASSES).optional(),
  object_name: z.string().superRefine((name, ctx) => {
    const problem = objectNameProblem(name)
    if (problem) ctx.addIssue({ code: 'custom', message: problem })
  }).optional(),
  mailto: z.string().min(1).regex(/^\S+$/, 'must not contain spaces').optional(),
  // the plugin takes false (no timestamp in the object name) or unset
  timestamp: z.literal(false).optional(),
}).strict()


const PropertyValueSchema = z.union([
  z.string(),
  z.number(),
  z.array(z.union([z.string(), z.number()])),
  z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
])

/**
 * `properties:` of a postgres or redis service: the plugin's own `:set` keys. Keys with
 * built-in handling are checked here; any other key passes through (`validate` warns on
 * keys the tested plugin version does not list).
 */
const ServicePropertiesSchema = z.record(z.string(), PropertyValueSchema).superRefine((props, ctx) => {
  const issue = (key: string, message: string) => ctx.addIssue({ code: 'custom', path: [key], message })
  for (const [key, value] of Object.entries(props)) {
    const rejected = rejectedReason(key)
    if (rejected) { issue(key, `'${key}' cannot be set here: ${rejected}`); continue }
    const kind = MANAGED_PROPERTIES[key]?.kind
    if (kind === 'map') {
      if (Array.isArray(value)) { issue(key, `'${key}' takes a map of names to values`); continue }
      for (const [name, v] of customEnvPairs(value as string | Record<string, string | number | boolean>)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) issue(key, `'${name}' is not an environment variable name`)
        if (/[;\r\n]/.test(v)) issue(key, `the value of ${name} must not contain ';' or a newline`)
        if (v === EXPORT_PLACEHOLDER) issue(key, `the value of ${name}: ${placeholderMessage}`)
      }
      if (typeof value === 'string' && /[\r\n]/.test(value)) issue(key, `'${key}' must be a single line`)
      continue
    }
    if (kind === 'list') {
      const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : undefined
      if (!items) { issue(key, `'${key}' takes a list`); continue }
      if (items.some(i => String(i).trim() === '' || /[,\s]/.test(String(i).trim()))) issue(key, `'${key}' entries must not be empty or contain commas or spaces`)
      continue
    }
    if (typeof value === 'object') { issue(key, `'${key}' takes a string or number`); continue }
    const text = String(value)
    if (text.trim() === '') { issue(key, `'${key}' is empty: leave the key out`); continue }
    if (/[\r\n]/.test(text)) { issue(key, `'${key}' must be a single line`); continue }
    if (kind === 'secret') {
      if (!/^[A-Za-z0-9._~-]+$/.test(text)) issue(key, `'${key}' may hold only letters, digits, '.', '_', '~' and '-'`)
      if (text === EXPORT_PLACEHOLDER) issue(key, placeholderMessage)
    } else if (key === 'memory') {
      if (!/^\d+$/.test(text.trim())) issue(key, 'memory is a whole number of megabytes (0 for no limit)')
    } else if (key === 'wait-timeout') {
      if (!/^\d+$/.test(text.trim()) || Number(text) < 1) issue(key, 'wait-timeout is a whole number of seconds greater than 0')
    }
  }
})

/** `mounts:` of a service: `<source>:<container-dir>[:<options>]`, no whitespace. */
const ServiceMountsSchema = z.array(
  z.string().min(1).regex(/^\S+$/, 'a mount spec must not contain whitespace').regex(/^[^:]+:[^:]+(:.*)?$/, 'a mount is <source>:<container-dir>[:<options>]')
)

const PostgresSchema = z.object({
  version: z.string().optional(),
  image: z.string().optional(),
  // false removes the service's backup schedule, credentials, encryption and settings; absent leaves them alone
  backup: z.union([ServiceBackupSchema, z.literal(false)]).optional(),
  // the plugin's `:set` keys; absent leaves them alone, `--prune` clears the known ones removed from the file
  properties: ServicePropertiesSchema.optional(),
  // the whole set of mounts; absent leaves them alone, [] removes them all
  mounts: ServiceMountsSchema.optional(),
}).strict()

const RedisSchema = z.object({
  version: z.string().optional(),
  image: z.string().optional(),
  // same blocks as postgres
  backup: z.union([ServiceBackupSchema, z.literal(false)]).optional(),
  properties: ServicePropertiesSchema.optional(),
  mounts: ServiceMountsSchema.optional(),
}).strict()

const PluginSchema = z.object({
  url: z.string().url(),
  version: z.string().optional(),
}).strict()

const DockerAuthEntrySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
}).strict()

export const ConfigSchema = z.object({
  dokku: z.object({
    version: z.string({ error: 'dokku.version must be a quoted string starting with X.Y.Z, e.g. "0.38.31"' })
      .regex(SEMVER_RE, 'dokku.version must start with X.Y.Z, e.g. "0.38.31"').optional(),
  }).strict().optional(),
  plugins: z.record(z.string(), PluginSchema).optional(),
  docker_auth: z.record(z.string(), DockerAuthEntrySchema).optional(),
  networks: sharedNetworksList.optional(),
  volumes: VolumesSchema.optional(),
  postgres: z.record(z.string(), PostgresSchema).optional(),
  redis: z.record(z.string(), RedisSchema).optional(),
  apps: z.record(z.string(), AppSchema),
  domains: z.union([z.array(z.string()), z.literal(false)]).optional(),
  env: EnvMapSchema.optional(),
  // The top-level blocks below are Dokku's own `--global` settings (`<ns>:set --global`); Dokku does the inheritance.
  nginx: propertyMap('nginx', NGINX_KEYS, StringOrNumber, ' --global').optional(),
  // Also takes the two keys only `logs:set --global` accepts.
  logs: propertyMap('logs', LOGS_GLOBAL_KEYS, StringOrNumber, ' --global').optional(),
  scheduler: SchedulerSchema.optional(),
  // `image-repo` names one app's repository: per app only, like the report-only `auth-servers`.
  registry: propertyMap('registry', REGISTRY_GLOBAL_KEYS, z.union([z.string(), z.boolean()]), ' --global').optional(),
  checks: GlobalChecksSchema.optional(),
  ps: GlobalPsSchema.optional(),
  build: GlobalBuildSchema.optional(),
  network: GlobalNetworkSchema.optional(),
  proxy: GlobalProxySchema.optional(),
  git: GlobalGitSchema.optional(),
}).strict().superRefine((config, ctx) => {
  // Mounts name declared entries, and no two of an app's mounts may share a container dir in overlapping scopes.
  for (const [app, appConfig] of Object.entries(config.apps)) {
    // Keep each mount's position in the list, so a message names the item it is about.
    const mounts = (appConfig.storage ?? []).flatMap((item, index) => {
      const [mount] = declaredMounts([item as string | MountItem])
      return mount ? [{ mount, index }] : []
    })
    mounts.forEach(({ mount: m, index }, i) => {
      const where = ['apps', app, 'storage', index]
      if (!config.volumes || !(m.entry in config.volumes)) {
        ctx.addIssue({ code: 'custom', path: where, message: `entry '${m.entry}' is not declared under volumes:` })
      }
      mounts.slice(0, i).forEach(({ mount: earlier }) => {
        if (earlier.container_dir !== m.container_dir || !scopesOverlap(earlier.process_type, m.process_type)) return
        const how = earlier.process_type === m.process_type
          ? `twice in ${m.process_type === DEFAULT_SCOPE ? 'every process' : `process type ${m.process_type}`}`
          : 'in the default scope and in a named process type, which Dokku forbids'
        ctx.addIssue({ code: 'custom', path: where, message: `container_dir '${m.container_dir}' is mounted ${how}` })
      })
    })
  }
})

export type Config = z.infer<typeof ConfigSchema>
export type AppConfig = z.infer<typeof AppSchema>
export type PostgresConfig = z.infer<typeof PostgresSchema>
export type RedisConfig = z.infer<typeof RedisSchema>
export type ServicePropertiesConfig = z.infer<typeof ServicePropertiesSchema>
export type ServiceBackupConfig = z.infer<typeof ServiceBackupSchema>
export type PluginConfig = z.infer<typeof PluginSchema>
export type DockerAuthEntry = z.infer<typeof DockerAuthEntrySchema>
export type GitConfig = z.infer<typeof GitSchema>
export type GlobalGitConfig = z.infer<typeof GlobalGitSchema>

export function parseConfig(raw: unknown): Config {
  return ConfigSchema.parse(raw)
}
