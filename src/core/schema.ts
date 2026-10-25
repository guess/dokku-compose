import { z } from 'zod'
import { SEMVER_RE } from '../modules/version.js'
import { NGINX_KEYS, LOGS_KEYS, LOGS_GLOBAL_KEYS, REGISTRY_KEYS } from '../resources/properties.js'

/** A free-form property map that only takes keys Dokku's `<ns>:set` accepts. */
function propertyMap<V extends z.ZodTypeAny>(namespace: string, keys: readonly string[], value: V) {
  return z.record(z.string(), value).superRefine((map, ctx) => {
    for (const key of Object.keys(map)) {
      if (!keys.includes(key)) {
        ctx.addIssue({ code: 'custom', path: [key], message: `'${key}' is not a ${namespace}:set property (valid: ${keys.join(', ')})` })
      }
    }
  })
}
const StringOrNumber = z.union([z.string(), z.number()])

const PortSchema = z.string().regex(
  /^(http|https|tcp|udp):\d+:\d+$/,
  'Port must be scheme:host:container (e.g. http:80:3000)'
)

const EnvMapSchema = z.union([
  z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  z.literal(false)
])

const ChecksSchema = z.union([
  z.literal(false),
  z.object({
    disabled: z.array(z.string()).optional(),
    skipped: z.array(z.string()).optional(),
    // The only `checks:set` key (Dokku 0.38.31); anything else is refused.
    'wait-to-retire': z.union([z.string(), z.number(), z.boolean()]).optional(),
  }).strict()
])

const GitSchema = z.object({
  deploy_branch: z.string().optional(),
  keep_git_dir: z.union([z.string(), z.boolean()]).optional(),
  rev_env_var: z.string().optional(),
  source_image: z.string().optional(),
  // Dokku reads `archive-max-files` and `archive-max-size` only from the global setting
  // (`git:set --global`), which dokku-compose does not manage yet; a per-app value never applies.
  archive_max_files: z.any().optional().refine(v => v === undefined, { message: 'archive_max_files is read only from the global git setting, which dokku-compose does not manage; run `dokku git:set --global archive-max-files <n>`' }),
  archive_max_size: z.any().optional().refine(v => v === undefined, { message: 'archive_max_size is read only from the global git setting, which dokku-compose does not manage; run `dokku git:set --global archive-max-size <n>`' }),
}).strict()

const LinkSchema = z.union([
  z.string(),
  z.object({
    service: z.string(),
    alias: z.string().min(1).optional(),
    env_var: z.string().min(1).optional(),
    querystring: z.string().min(1).optional(),
  }).strict().refine(l => !(l.alias && l.env_var), { message: '`alias` and `env_var` cannot be combined' }),
])

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
  storage: z.array(z.string()).optional(),
  proxy: z.object({
    enabled: z.boolean().optional(),
    type: z.string().optional(),
    proxy_port: StringOrNumber.optional(),
    proxy_ssl_port: StringOrNumber.optional(),
  }).strict().optional(),
  networks: z.array(z.string()).optional(),
  network: z.object({
    attach_post_create: z.union([z.array(z.string()), z.literal(false)]).optional(),
    initial_network: z.union([z.string(), z.literal(false)]).optional(),
    bind_all_interfaces: z.boolean().optional(),
    static_web_listener: z.union([z.string(), z.literal(false)]).optional(),
    tld: z.union([z.string(), z.literal(false)]).optional(),
  }).strict().optional(),
  nginx: propertyMap('nginx', NGINX_KEYS, StringOrNumber).optional(),
  logs: propertyMap('logs', LOGS_KEYS, StringOrNumber).optional(),
  // `auth-servers` is report-only: it is a registry login, not a `registry:set` key.
  registry: propertyMap('registry', REGISTRY_KEYS, z.union([z.string(), z.boolean()])).optional(),
  scheduler: z.union([z.string(), z.object({ selected: z.string().optional(), shell: z.string().optional() }).strict()]).optional(),
  scale: z.record(z.string(), z.preprocess(v => (typeof v === 'string' && /^\s*-?\d+\s*$/.test(v) ? Number(v) : v), z.number().int().min(0))).optional(),
  ps: z.object({
    'procfile-path': z.union([z.string(), z.number()]).optional(),
    'restart-policy': z.union([z.string(), z.number()]).optional(),
    'stop-timeout-seconds': z.union([z.string(), z.number()]).optional(),
    'dockerfile-start-cmd': z.union([z.string(), z.number()]).optional(),
    restore: z.union([z.string(), z.boolean()]).optional(),
    'skip-deploy': z.union([z.string(), z.boolean()]).optional(),
    'start-cmd': z.union([z.string(), z.number()]).optional(),
  }).strict().optional(),
  checks: ChecksSchema.optional(),
  build: z.object({
    dockerfile: z.string().optional(),
    app_json: z.string().optional(),
    context: z.string().optional(),
    selected: z.string().optional(),
    skip_cleanup: z.union([z.string(), z.boolean()]).optional(),
    args: z.record(z.string(), z.string()).optional(),
  }).strict().optional(),
  docker_options: z.object({
    build: z.array(z.string()).optional(),
    deploy: z.array(z.string()).optional(),
    run: z.array(z.string()).optional(),
  }).strict().optional(),
  git: GitSchema.optional(),
}).strict()

const ServiceBackupAuthSchema = z.object({
  access_key_id: z.string().min(1),
  secret_access_key: z.string().min(1),
  region: z.string().min(1),
  signature_version: z.string().min(1),
  endpoint: z.string().min(1),
}).strict()

const ServiceBackupSchema = z.object({
  schedule: z.string().min(1),
  bucket: z.string().min(1),
  auth: ServiceBackupAuthSchema,
}).strict()

const PostgresSchema = z.object({
  version: z.string().optional(),
  image: z.string().optional(),
  // false removes the service's backup schedule and credentials; absent leaves them alone
  backup: z.union([ServiceBackupSchema, z.literal(false)]).optional(),
}).strict()

const RedisSchema = z.object({
  version: z.string().optional(),
  image: z.string().optional(),
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
  networks: z.array(z.string()).optional(),
  postgres: z.record(z.string(), PostgresSchema).optional(),
  redis: z.record(z.string(), RedisSchema).optional(),
  apps: z.record(z.string(), AppSchema),
  domains: z.union([z.array(z.string()), z.literal(false)]).optional(),
  env: EnvMapSchema.optional(),
  nginx: propertyMap('nginx', NGINX_KEYS, StringOrNumber).optional(),
  // The top-level block is also applied with `--global`, which takes two more keys.
  logs: propertyMap('logs', LOGS_GLOBAL_KEYS, StringOrNumber).optional(),
  git: GitSchema.optional(),
}).strict()

export type Config = z.infer<typeof ConfigSchema>
export type AppConfig = z.infer<typeof AppSchema>
export type PostgresConfig = z.infer<typeof PostgresSchema>
export type RedisConfig = z.infer<typeof RedisSchema>
export type ServiceBackupConfig = z.infer<typeof ServiceBackupSchema>
export type PluginConfig = z.infer<typeof PluginSchema>
export type DockerAuthEntry = z.infer<typeof DockerAuthEntrySchema>
export type GitConfig = z.infer<typeof GitSchema>

export function parseConfig(raw: unknown): Config {
  return ConfigSchema.parse(raw)
}
