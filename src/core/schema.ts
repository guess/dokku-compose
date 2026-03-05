import { z } from 'zod'

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
  }).catchall(z.union([z.string(), z.number(), z.boolean()]))
])

const GitSchema = z.object({
  deploy_branch: z.string().optional(),
})

const AppSchema = z.object({
  domains: z.union([z.array(z.string()), z.literal(false)]).optional(),
  links: z.array(z.string()).optional(),
  ports: z.array(PortSchema).optional(),
  env: EnvMapSchema.optional(),
  ssl: z.union([
    z.literal(false),
    z.literal(true),
    z.object({ certfile: z.string(), keyfile: z.string() })
  ]).optional(),
  storage: z.array(z.string()).optional(),
  proxy: z.object({ enabled: z.boolean() }).optional(),
  networks: z.array(z.string()).optional(),
  network: z.object({
    attach_post_create: z.union([z.array(z.string()), z.literal(false)]).optional(),
    initial_network: z.union([z.string(), z.literal(false)]).optional(),
    bind_all_interfaces: z.boolean().optional(),
    tld: z.union([z.string(), z.literal(false)]).optional(),
  }).optional(),
  nginx: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  logs: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  registry: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
  scheduler: z.string().optional(),
  checks: ChecksSchema.optional(),
  build: z.object({
    dockerfile: z.string().optional(),
    app_json: z.string().optional(),
    context: z.string().optional(),
    args: z.record(z.string(), z.string()).optional(),
  }).optional(),
  docker_options: z.object({
    build: z.array(z.string()).optional(),
    deploy: z.array(z.string()).optional(),
    run: z.array(z.string()).optional(),
  }).optional(),
  git: GitSchema.optional(),
})

const ServiceBackupAuthSchema = z.object({
  access_key_id: z.string(),
  secret_access_key: z.string(),
  region: z.string(),
  signature_version: z.string(),
  endpoint: z.string(),
})

const ServiceBackupSchema = z.object({
  schedule: z.string(),
  bucket: z.string(),
  auth: ServiceBackupAuthSchema,
})

const PostgresSchema = z.object({
  version: z.string().optional(),
  image: z.string().optional(),
  backup: ServiceBackupSchema.optional(),
})

const RedisSchema = z.object({
  version: z.string().optional(),
  image: z.string().optional(),
})

const PluginSchema = z.object({
  url: z.string().url(),
  version: z.string().optional(),
})

export const ConfigSchema = z.object({
  dokku: z.object({
    version: z.string().optional(),
  }).optional(),
  plugins: z.record(z.string(), PluginSchema).optional(),
  networks: z.array(z.string()).optional(),
  postgres: z.record(z.string(), PostgresSchema).optional(),
  redis: z.record(z.string(), RedisSchema).optional(),
  apps: z.record(z.string(), AppSchema),
  domains: z.union([z.array(z.string()), z.literal(false)]).optional(),
  env: EnvMapSchema.optional(),
  nginx: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  logs: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  git: GitSchema.optional(),
})

export type Config = z.infer<typeof ConfigSchema>
export type AppConfig = z.infer<typeof AppSchema>
export type PostgresConfig = z.infer<typeof PostgresSchema>
export type RedisConfig = z.infer<typeof RedisSchema>
export type ServiceBackupConfig = z.infer<typeof ServiceBackupSchema>
export type PluginConfig = z.infer<typeof PluginSchema>
export type GitConfig = z.infer<typeof GitSchema>

export function parseConfig(raw: unknown): Config {
  return ConfigSchema.parse(raw)
}
