# Top-level postgres/redis Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the generic `services:` key with dedicated `postgres:` and `redis:` top-level config keys, each with their own schema.

**Architecture:** Two separate modules (`postgres.ts`, `redis.ts`) replace `services.ts`. A shared `links.ts` helper resolves service names to plugin types by scanning both config keys. Backup config is postgres-only.

**Tech Stack:** TypeScript, Zod, Vitest

---

### Task 1: Update Schema

**Files:**
- Modify: `src/core/schema.ts`

**Step 1: Update schema definitions**

Replace the `ServiceSchema` + `services` config key with two separate schemas:

```typescript
// Replace ServiceSchema and ServiceBackupAuthSchema/ServiceBackupSchema with:

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

// In ConfigSchema, replace:
//   services: z.record(z.string(), ServiceSchema).optional(),
// with:
//   postgres: z.record(z.string(), PostgresSchema).optional(),
//   redis: z.record(z.string(), RedisSchema).optional(),
```

Update type exports:

```typescript
export type PostgresConfig = z.infer<typeof PostgresSchema>
export type RedisConfig = z.infer<typeof RedisSchema>
export type ServiceBackupConfig = z.infer<typeof ServiceBackupSchema>
// Remove: ServiceConfig
```

**Step 2: Run tests to see what breaks**

Run: `bun test`
Expected: Many failures from modules/commands still referencing `config.services` and `ServiceConfig`

**Step 3: Commit**

```
git add src/core/schema.ts
git commit -m "refactor: replace services schema with postgres/redis top-level keys"
```

---

### Task 2: Create Links Helper

**Files:**
- Create: `src/modules/links.ts`
- Create: `src/modules/links.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { resolveServicePlugin, ensureAppLinks, destroyAppLinks, exportAppLinks } from './links.js'
import type { Config } from '../core/schema.js'

describe('resolveServicePlugin', () => {
  it('finds postgres service', () => {
    const config = {
      apps: {},
      postgres: { 'api-db': {} },
      redis: { 'api-cache': {} },
    } as Config
    expect(resolveServicePlugin('api-db', config)).toEqual({ plugin: 'postgres', config: {} })
  })

  it('finds redis service', () => {
    const config = {
      apps: {},
      postgres: { 'api-db': {} },
      redis: { 'api-cache': {} },
    } as Config
    expect(resolveServicePlugin('api-cache', config)).toEqual({ plugin: 'redis', config: {} })
  })

  it('returns undefined for unknown service', () => {
    const config = { apps: {} } as Config
    expect(resolveServicePlugin('unknown', config)).toBeUndefined()
  })
})

describe('ensureAppLinks', () => {
  it('links desired services not yet linked', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    const config = {
      apps: {},
      postgres: { 'api-db': {} },
    } as Config
    await ensureAppLinks(ctx, 'myapp', ['api-db'], config)
    expect(runner.run).toHaveBeenCalledWith('postgres:link', 'api-db', 'myapp', '--no-restart')
  })

  it('unlinks services not in desired list', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)  // already linked
    runner.run = vi.fn()
    const ctx = createContext(runner)
    const config = {
      apps: {},
      postgres: { 'api-db': {} },
    } as Config
    await ensureAppLinks(ctx, 'myapp', [], config)
    expect(runner.run).toHaveBeenCalledWith('postgres:unlink', 'api-db', 'myapp', '--no-restart')
  })
})

describe('exportAppLinks', () => {
  it('returns linked service names', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockImplementation(async (...args: string[]) =>
      args[0] === 'postgres:linked' ? true : false
    )
    const ctx = createContext(runner)
    const config = {
      apps: {},
      postgres: { 'api-db': {} },
      redis: { 'api-cache': {} },
    } as Config
    const result = await exportAppLinks(ctx, 'myapp', config)
    expect(result).toEqual(['api-db'])
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/modules/links.test.ts`
Expected: FAIL — module doesn't exist yet

**Step 3: Implement links.ts**

```typescript
import type { Context } from '../core/context.js'
import type { Config } from '../core/schema.js'
import { logAction, logDone } from '../core/logger.js'

export function resolveServicePlugin(
  name: string,
  config: Config
): { plugin: string; config: Record<string, unknown> } | undefined {
  if (config.postgres?.[name]) return { plugin: 'postgres', config: config.postgres[name] }
  if (config.redis?.[name]) return { plugin: 'redis', config: config.redis[name] }
  return undefined
}

/** All service entries across both plugins, as [name, plugin] pairs */
function allServices(config: Config): [string, string][] {
  const entries: [string, string][] = []
  for (const name of Object.keys(config.postgres ?? {})) entries.push([name, 'postgres'])
  for (const name of Object.keys(config.redis ?? {})) entries.push([name, 'redis'])
  return entries
}

export async function ensureAppLinks(
  ctx: Context,
  app: string,
  desiredLinks: string[],
  config: Config
): Promise<void> {
  const desiredSet = new Set(desiredLinks)

  for (const [serviceName, plugin] of allServices(config)) {
    const isLinked = await ctx.check(`${plugin}:linked`, serviceName, app)
    const isDesired = desiredSet.has(serviceName)

    if (isDesired && !isLinked) {
      logAction(app, `Linking ${serviceName}`)
      await ctx.run(`${plugin}:link`, serviceName, app, '--no-restart')
      logDone()
    } else if (!isDesired && isLinked) {
      logAction(app, `Unlinking ${serviceName}`)
      await ctx.run(`${plugin}:unlink`, serviceName, app, '--no-restart')
      logDone()
    }
  }
}

export async function destroyAppLinks(
  ctx: Context,
  app: string,
  links: string[],
  config: Config
): Promise<void> {
  for (const serviceName of links) {
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
): Promise<string[]> {
  const linked: string[] = []
  for (const [serviceName, plugin] of allServices(config)) {
    const isLinked = await ctx.check(`${plugin}:linked`, serviceName, app)
    if (isLinked) linked.push(serviceName)
  }
  return linked
}
```

**Step 4: Run tests**

Run: `bun test src/modules/links.test.ts`
Expected: PASS

**Step 5: Commit**

```
git add src/modules/links.ts src/modules/links.test.ts
git commit -m "feat: add links helper for cross-plugin service resolution"
```

---

### Task 3: Create Postgres Module

**Files:**
- Create: `src/modules/postgres.ts`
- Create: `src/modules/postgres.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { ensurePostgres, ensurePostgresBackups, destroyPostgres, exportPostgres } from './postgres.js'

describe('ensurePostgres', () => {
  it('creates service that does not exist', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensurePostgres(ctx, { 'api-db': {} })
    expect(runner.run).toHaveBeenCalledWith('postgres:create', 'api-db')
  })

  it('skips service that exists', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensurePostgres(ctx, { 'api-db': {} })
    expect(runner.run).not.toHaveBeenCalled()
  })

  it('passes --image and --image-version flags', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensurePostgres(ctx, { 'api-db': { image: 'postgis/postgis', version: '17-3.5' } })
    expect(runner.run).toHaveBeenCalledWith(
      'postgres:create', 'api-db', '--image', 'postgis/postgis', '--image-version', '17-3.5'
    )
  })
})

describe('ensurePostgresBackups', () => {
  const backup = {
    schedule: '0 * * * *',
    bucket: 'db-backups/api-db',
    auth: {
      access_key_id: 'KEY',
      secret_access_key: 'SECRET',
      region: 'auto',
      signature_version: 's3v4',
      endpoint: 'https://r2.example.com',
    },
  }

  it('configures backup when hash differs', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    runner.query = vi.fn().mockResolvedValue('')
    const ctx = createContext(runner)
    await ensurePostgresBackups(ctx, { 'api-db': { backup } })
    expect(runner.run).toHaveBeenCalledWith('postgres:backup-deauth', 'api-db')
    expect(runner.run).toHaveBeenCalledWith(
      'postgres:backup-auth', 'api-db', 'KEY', 'SECRET', 'auto', 's3v4', 'https://r2.example.com'
    )
    expect(runner.run).toHaveBeenCalledWith('postgres:backup-schedule', 'api-db', '0 * * * *', 'db-backups/api-db')
  })

  it('skips when hash matches', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    const { createHash } = await import('crypto')
    const hash = createHash('sha256').update(JSON.stringify(backup)).digest('hex')
    runner.query = vi.fn().mockResolvedValue(hash)
    const ctx = createContext(runner)
    await ensurePostgresBackups(ctx, { 'api-db': { backup } })
    expect(runner.run).not.toHaveBeenCalled()
  })

  it('skips entries without backup config', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensurePostgresBackups(ctx, { 'api-db': {} })
    expect(runner.run).not.toHaveBeenCalled()
  })
})

describe('destroyPostgres', () => {
  it('destroys existing service', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await destroyPostgres(ctx, { 'api-db': {} })
    expect(runner.run).toHaveBeenCalledWith('postgres:destroy', 'api-db', '--force')
  })
})

describe('exportPostgres', () => {
  it('exports postgres services with version and custom image', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'postgres:list') return 'NAME        VERSION             STATUS   EXPOSED PORTS  LINKS\napi-db      postgis/postgis:17-3.5  running  -              api'
      if (args[0] === 'postgres:info') return '=====> api-db postgres service information\n       Version:             postgis/postgis:17-3.5'
      return ''
    })
    const ctx = createContext(runner)
    const result = await exportPostgres(ctx)
    expect(result).toEqual({
      'api-db': { image: 'postgis/postgis', version: '17-3.5' },
    })
  })

  it('omits image when it matches default (postgres)', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'postgres:list') return 'NAME        VERSION       STATUS   EXPOSED PORTS  LINKS\napi-db      postgres:16   running  -              api'
      if (args[0] === 'postgres:info') return '=====> api-db postgres service information\n       Version:             postgres:16'
      return ''
    })
    const ctx = createContext(runner)
    const result = await exportPostgres(ctx)
    expect(result).toEqual({
      'api-db': { version: '16' },
    })
  })

  it('returns empty record when no services', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('NAME        VERSION       STATUS   EXPOSED PORTS  LINKS')
    const ctx = createContext(runner)
    const result = await exportPostgres(ctx)
    expect(result).toEqual({})
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/modules/postgres.test.ts`
Expected: FAIL

**Step 3: Implement postgres.ts**

```typescript
import { createHash } from 'crypto'
import type { Context } from '../core/context.js'
import type { PostgresConfig, ServiceBackupConfig } from '../core/schema.js'
import { logAction, logDone, logSkip } from '../core/logger.js'

function backupHashKey(serviceName: string): string {
  return 'DOKKU_COMPOSE_BACKUP_HASH_' + serviceName.toUpperCase().replace(/-/g, '_')
}

function computeBackupHash(backup: ServiceBackupConfig): string {
  return createHash('sha256').update(JSON.stringify(backup)).digest('hex')
}

export async function ensurePostgres(
  ctx: Context,
  services: Record<string, PostgresConfig>
): Promise<void> {
  for (const [name, config] of Object.entries(services)) {
    logAction('services', `Ensuring ${name}`)
    const exists = await ctx.check('postgres:exists', name)
    if (exists) { logSkip(); continue }
    const args: string[] = ['postgres:create', name]
    if (config.image) args.push('--image', config.image)
    if (config.version) args.push('--image-version', config.version)
    await ctx.run(...args)
    logDone()
  }
}

export async function ensurePostgresBackups(
  ctx: Context,
  services: Record<string, PostgresConfig>
): Promise<void> {
  for (const [name, config] of Object.entries(services)) {
    if (!config.backup) continue
    logAction('services', `Configuring backup for ${name}`)
    const hashKey = backupHashKey(name)
    const desiredHash = computeBackupHash(config.backup)
    const storedHash = await ctx.query('config:get', '--global', hashKey)
    if (storedHash === desiredHash) { logSkip(); continue }
    const { schedule, bucket, auth } = config.backup
    await ctx.run('postgres:backup-deauth', name)
    await ctx.run(
      'postgres:backup-auth', name,
      auth.access_key_id, auth.secret_access_key,
      auth.region, auth.signature_version, auth.endpoint
    )
    await ctx.run('postgres:backup-schedule', name, schedule, bucket)
    await ctx.run('config:set', '--global', `${hashKey}=${desiredHash}`)
    logDone()
  }
}

export async function destroyPostgres(
  ctx: Context,
  services: Record<string, PostgresConfig>
): Promise<void> {
  for (const [name] of Object.entries(services)) {
    logAction('services', `Destroying ${name}`)
    const exists = await ctx.check('postgres:exists', name)
    if (!exists) { logSkip(); continue }
    await ctx.run('postgres:destroy', name, '--force')
    logDone()
  }
}

export async function exportPostgres(
  ctx: Context
): Promise<Record<string, PostgresConfig>> {
  const services: Record<string, PostgresConfig> = {}
  const listOutput = await ctx.query('postgres:list')
  const lines = listOutput.split('\n').slice(1)

  for (const line of lines) {
    const name = line.trim().split(/\s+/)[0]
    if (!name) continue

    const infoOutput = await ctx.query('postgres:info', name)
    const versionMatch = infoOutput.match(/Version:\s+(\S+)/)
    if (!versionMatch) continue

    const versionField = versionMatch[1]
    const colonIdx = versionField.lastIndexOf(':')

    const config: PostgresConfig = {}
    if (colonIdx > 0) {
      const image = versionField.slice(0, colonIdx)
      const version = versionField.slice(colonIdx + 1)
      if (image !== 'postgres') config.image = image
      if (version) config.version = version
    } else {
      config.version = versionField
    }

    services[name] = config
  }

  return services
}
```

**Step 4: Run tests**

Run: `bun test src/modules/postgres.test.ts`
Expected: PASS

**Step 5: Commit**

```
git add src/modules/postgres.ts src/modules/postgres.test.ts
git commit -m "feat: add postgres module with ensure, destroy, backup, export"
```

---

### Task 4: Create Redis Module

**Files:**
- Create: `src/modules/redis.ts`
- Create: `src/modules/redis.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { ensureRedis, destroyRedis, exportRedis } from './redis.js'

describe('ensureRedis', () => {
  it('creates service that does not exist', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensureRedis(ctx, { 'api-cache': {} })
    expect(runner.run).toHaveBeenCalledWith('redis:create', 'api-cache')
  })

  it('skips service that exists', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensureRedis(ctx, { 'api-cache': {} })
    expect(runner.run).not.toHaveBeenCalled()
  })

  it('passes --image-version flag', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await ensureRedis(ctx, { 'api-cache': { version: '7.2-alpine' } })
    expect(runner.run).toHaveBeenCalledWith('redis:create', 'api-cache', '--image-version', '7.2-alpine')
  })
})

describe('destroyRedis', () => {
  it('destroys existing service', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)
    runner.run = vi.fn()
    const ctx = createContext(runner)
    await destroyRedis(ctx, { 'api-cache': {} })
    expect(runner.run).toHaveBeenCalledWith('redis:destroy', 'api-cache', '--force')
  })
})

describe('exportRedis', () => {
  it('exports redis services with version', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'redis:list') return 'NAME        VERSION          STATUS   EXPOSED PORTS  LINKS\napi-cache   redis:7.2-alpine running  -              api'
      if (args[0] === 'redis:info') return '=====> api-cache redis service information\n       Version:             redis:7.2-alpine'
      return ''
    })
    const ctx = createContext(runner)
    const result = await exportRedis(ctx)
    expect(result).toEqual({
      'api-cache': { version: '7.2-alpine' },
    })
  })

  it('returns empty record when no services', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('NAME        VERSION       STATUS   EXPOSED PORTS  LINKS')
    const ctx = createContext(runner)
    const result = await exportRedis(ctx)
    expect(result).toEqual({})
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/modules/redis.test.ts`

**Step 3: Implement redis.ts**

Same pattern as postgres but hardcoded to `redis:` commands, no backup support.

```typescript
import type { Context } from '../core/context.js'
import type { RedisConfig } from '../core/schema.js'
import { logAction, logDone, logSkip } from '../core/logger.js'

export async function ensureRedis(
  ctx: Context,
  services: Record<string, RedisConfig>
): Promise<void> {
  for (const [name, config] of Object.entries(services)) {
    logAction('services', `Ensuring ${name}`)
    const exists = await ctx.check('redis:exists', name)
    if (exists) { logSkip(); continue }
    const args: string[] = ['redis:create', name]
    if (config.image) args.push('--image', config.image)
    if (config.version) args.push('--image-version', config.version)
    await ctx.run(...args)
    logDone()
  }
}

export async function destroyRedis(
  ctx: Context,
  services: Record<string, RedisConfig>
): Promise<void> {
  for (const [name] of Object.entries(services)) {
    logAction('services', `Destroying ${name}`)
    const exists = await ctx.check('redis:exists', name)
    if (!exists) { logSkip(); continue }
    await ctx.run('redis:destroy', name, '--force')
    logDone()
  }
}

export async function exportRedis(
  ctx: Context
): Promise<Record<string, RedisConfig>> {
  const services: Record<string, RedisConfig> = {}
  const listOutput = await ctx.query('redis:list')
  const lines = listOutput.split('\n').slice(1)

  for (const line of lines) {
    const name = line.trim().split(/\s+/)[0]
    if (!name) continue

    const infoOutput = await ctx.query('redis:info', name)
    const versionMatch = infoOutput.match(/Version:\s+(\S+)/)
    if (!versionMatch) continue

    const versionField = versionMatch[1]
    const colonIdx = versionField.lastIndexOf(':')

    const config: RedisConfig = {}
    if (colonIdx > 0) {
      const image = versionField.slice(0, colonIdx)
      const version = versionField.slice(colonIdx + 1)
      if (image !== 'redis') config.image = image
      if (version) config.version = version
    } else {
      config.version = versionField
    }

    services[name] = config
  }

  return services
}
```

**Step 4: Run tests**

Run: `bun test src/modules/redis.test.ts`
Expected: PASS

**Step 5: Commit**

```
git add src/modules/redis.ts src/modules/redis.test.ts
git commit -m "feat: add redis module with ensure, destroy, export"
```

---

### Task 5: Update Test Fixtures

**Files:**
- Modify: `src/tests/fixtures/simple.yml`
- Modify: `src/tests/fixtures/full.yml`

**Step 1: Update simple.yml**

```yaml
plugins:
  postgres:
    url: https://github.com/dokku/dokku-postgres.git

networks:
  - app-net

postgres:
  myapp-postgres: {}

apps:
  myapp:
    build:
      context: apps/myapp
    ports:
      - "http:5000:5000"
    links:
      - myapp-postgres
```

**Step 2: Update full.yml**

```yaml
dokku:
  version: "0.35.12"

plugins:
  postgres:
    url: https://github.com/dokku/dokku-postgres.git
    version: "1.41.0"
  redis:
    url: https://github.com/dokku/dokku-redis.git

networks:
  - studio-net
  - qultr-net

postgres:
  funqtion-postgres:
    version: "17-3.5"
    image: postgis/postgis
  studio-postgres: {}
  qultr-postgres: {}

redis:
  funqtion-redis:
    version: "7.2-alpine"
  studio-redis: {}
  qultr-redis: {}

apps:
  # ... (same as before, no changes to apps section)
```

**Step 3: Commit**

```
git add src/tests/fixtures/simple.yml src/tests/fixtures/full.yml
git commit -m "refactor: update test fixtures for postgres/redis top-level keys"
```

---

### Task 6: Update Commands (up, down, export, diff)

**Files:**
- Modify: `src/commands/up.ts`
- Modify: `src/commands/down.ts`
- Modify: `src/commands/export.ts`
- Modify: `src/commands/diff.ts`

**Step 1: Update up.ts**

Replace imports and service calls:

```typescript
// Replace:
import { ensureServices, ensureServiceBackups, ensureAppLinks } from '../modules/services.js'

// With:
import { ensurePostgres, ensurePostgresBackups } from '../modules/postgres.js'
import { ensureRedis } from '../modules/redis.js'
import { ensureAppLinks } from '../modules/links.js'

// Phase 4: Services — replace:
//   if (config.services) await ensureServices(ctx, config.services)
//   if (config.services) await ensureServiceBackups(ctx, config.services)
// with:
if (config.postgres) await ensurePostgres(ctx, config.postgres)
if (config.redis) await ensureRedis(ctx, config.redis)
if (config.postgres) await ensurePostgresBackups(ctx, config.postgres)

// Phase 5 links — replace:
//   if (config.services) {
//     await ensureAppLinks(ctx, app, appConfig.links ?? [], config.services)
//   }
// with:
if (config.postgres || config.redis) {
  await ensureAppLinks(ctx, app, appConfig.links ?? [], config)
}
```

**Step 2: Update down.ts**

```typescript
// Replace:
import { destroyAppLinks, destroyServices } from '../modules/services.js'

// With:
import { destroyPostgres } from '../modules/postgres.js'
import { destroyRedis } from '../modules/redis.js'
import { destroyAppLinks } from '../modules/links.js'

// Phase 1 links — replace:
//   if (config.services && appConfig.links) {
//     await destroyAppLinks(ctx, app, appConfig.links, config.services)
//   }
// with:
if (appConfig.links && (config.postgres || config.redis)) {
  await destroyAppLinks(ctx, app, appConfig.links, config)
}

// Phase 2 — replace:
//   if (config.services) { await destroyServices(ctx, config.services) }
// with:
if (config.postgres) await destroyPostgres(ctx, config.postgres)
if (config.redis) await destroyRedis(ctx, config.redis)
```

**Step 3: Update export.ts**

```typescript
// Replace:
import { exportServices, exportAppLinks } from '../modules/services.js'

// With:
import { exportPostgres } from '../modules/postgres.js'
import { exportRedis } from '../modules/redis.js'
import { exportAppLinks } from '../modules/links.js'

// Services section — replace:
//   const services = await exportServices(ctx)
//   if (Object.keys(services).length > 0) config.services = services
// with:
const postgres = await exportPostgres(ctx)
if (Object.keys(postgres).length > 0) config.postgres = postgres
const redis = await exportRedis(ctx)
if (Object.keys(redis).length > 0) config.redis = redis

// Per-app links — replace:
//   if (Object.keys(services).length > 0) {
//     const links = await exportAppLinks(ctx, app, services)
//     ...
//   }
// with:
if (config.postgres || config.redis) {
  const links = await exportAppLinks(ctx, app, config)
  if (links.length > 0) appConfig.links = links
}
```

**Step 4: Update diff.ts**

Replace the services diff section:

```typescript
// Replace:
//   for (const [svc, svcConfig] of Object.entries(config.services ?? {})) {
//     const exists = await ctx.check(`${svcConfig.plugin}:exists`, svc)
//     ...
//   }
// with:
for (const [svc] of Object.entries(config.postgres ?? {})) {
  const exists = await ctx.check('postgres:exists', svc)
  result.services[svc] = { status: exists ? 'in-sync' : 'missing' }
  if (!exists) result.inSync = false
}
for (const [svc] of Object.entries(config.redis ?? {})) {
  const exists = await ctx.check('redis:exists', svc)
  result.services[svc] = { status: exists ? 'in-sync' : 'missing' }
  if (!exists) result.inSync = false
}
```

**Step 5: Run all tests**

Run: `bun test`
Expected: PASS (or fix remaining issues)

**Step 6: Commit**

```
git add src/commands/up.ts src/commands/down.ts src/commands/export.ts src/commands/diff.ts
git commit -m "refactor: update commands for postgres/redis top-level keys"
```

---

### Task 7: Update Command Tests

**Files:**
- Modify: `src/commands/up.test.ts`
- Modify: `src/commands/down.test.ts`
- Modify: `src/commands/export.test.ts`

**Step 1: Update up.test.ts**

Tests load fixtures which are already updated. Just verify existing assertions still hold:
- `postgres:create` and `postgres:link` calls should still match
- The `plugin:list` mock in dry-run test stays since plugins module still queries it

**Step 2: Update down.test.ts**

Same — fixtures drive the config. The `postgres:destroy` assertion should still work.

**Step 3: Update export.test.ts**

The export test mocks `runner.query`. The service-related queries now go through `exportPostgres`/`exportRedis` which query `postgres:list`/`redis:list`. Add mocks for these if needed, or verify existing tests still pass since the export function signature hasn't changed.

**Step 4: Run all tests**

Run: `bun test`
Expected: PASS

**Step 5: Commit**

```
git add src/commands/up.test.ts src/commands/down.test.ts src/commands/export.test.ts
git commit -m "test: update command tests for postgres/redis keys"
```

---

### Task 8: Delete Old services.ts

**Files:**
- Delete: `src/modules/services.ts`
- Delete: `src/modules/services.test.ts`

**Step 1: Verify no remaining imports**

Run: `grep -r "from.*services" src/ --include="*.ts" | grep -v node_modules | grep -v ".test.ts"`

Expected: No results (all imports have been updated)

**Step 2: Delete files**

```bash
rm src/modules/services.ts src/modules/services.test.ts
```

**Step 3: Run all tests**

Run: `bun test`
Expected: PASS

**Step 4: Commit**

```
git add -A
git commit -m "refactor: remove old services module"
```

---

### Task 9: Update Documentation

**Files:**
- Modify: `docs/reference/plugins.md`
- Modify: `README.md`

**Step 1: Update docs/reference/plugins.md**

Replace the "Service Declaration" section to document `postgres:` and `redis:` top-level keys instead of `services:`. Replace service YAML examples throughout. Remove `plugin` field from examples. Move backup docs under the postgres section. Keep the "Linking Services to Apps" and "Shared Services" sections but update examples.

**Step 2: Update README.md**

Replace the "Plugins and Services" section (lines ~354-374) with updated YAML example showing `postgres:` and `redis:` keys.

**Step 3: Commit**

```
git add docs/reference/plugins.md README.md
git commit -m "docs: update reference and README for postgres/redis top-level keys"
```

---

### Task 10: Final Verification

**Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 2: Dry-run with a real config (if available)**

Run: `./bin/dokku-compose validate` against an updated YAML file to verify schema validation works.

**Step 3: Commit any remaining fixes**

---

## Task Dependency Order

```
Task 1 (schema) → Task 2 (links) → Task 3 (postgres) → Task 4 (redis) → Task 5 (fixtures) → Task 6 (commands) → Task 7 (command tests) → Task 8 (delete old) → Task 9 (docs) → Task 10 (verify)
```

Tasks 2-4 can be done in parallel after Task 1. Tasks 3 and 4 are independent of each other.
