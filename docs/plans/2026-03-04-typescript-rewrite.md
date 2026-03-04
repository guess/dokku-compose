# TypeScript Rewrite Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite dokku-compose from bash to TypeScript, preserving all existing behaviour and adding `validate`, `export`, and `diff` commands.

**Architecture:** Commander.js CLI with one file per module under `src/modules/`. Each module exports `ensure()`, optionally `destroy()`, and `exportState()` for the export/diff engine. Zod defines the config schema used by both validation and TypeScript types throughout.

**Tech Stack:** TypeScript, Commander.js, Zod, js-yaml, chalk, execa, vitest

---

## Task 1: Project scaffold

**Files:**
- Create: `src/package.json`
- Create: `src/tsconfig.json`
- Create: `src/vitest.config.ts`
- Create: `src/index.ts` (empty entry point)

**Step 1: Init npm package**

```bash
mkdir -p src
cd src
npm init -y
```

**Step 2: Install dependencies**

```bash
npm install commander js-yaml chalk execa zod
npm install -D typescript @types/node @types/js-yaml vitest tsx tsup
```

**Step 3: Write `src/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Write `src/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { globals: true }
})
```

**Step 5: Add scripts to `src/package.json`**

```json
{
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "tsup index.ts --format esm --dts",
    "dev": "tsx index.ts"
  }
}
```

**Step 6: Run tests to verify scaffold works**

```bash
cd src && npx vitest run
```
Expected: 0 tests found, 0 failures.

**Step 7: Commit**

```bash
git add src/
git commit -m "feat: add TypeScript project scaffold"
```

---

## Task 2: Core — config schema (Zod)

The Zod schema is the single source of truth for config structure. It drives TypeScript types, validation errors, and YAML parsing.

**Files:**
- Create: `src/core/schema.ts`
- Create: `src/core/schema.test.ts`

**Step 1: Write failing test**

```typescript
// src/core/schema.test.ts
import { describe, it, expect } from 'vitest'
import { parseConfig } from './schema.js'

describe('parseConfig', () => {
  it('parses minimal config', () => {
    const result = parseConfig({
      apps: { myapp: { ports: ['http:80:3000'] } }
    })
    expect(result.apps['myapp'].ports).toEqual(['http:80:3000'])
  })

  it('rejects invalid port format', () => {
    expect(() => parseConfig({
      apps: { myapp: { ports: ['80:3000'] } }
    })).toThrow()
  })

  it('allows env: false', () => {
    const result = parseConfig({ apps: { myapp: { env: false } } })
    expect(result.apps['myapp'].env).toBe(false)
  })
})
```

**Step 2: Run to verify it fails**

```bash
cd src && npx vitest run core/schema.test.ts
```
Expected: FAIL — `parseConfig` not found.

**Step 3: Write `src/core/schema.ts`**

```typescript
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

const AppSchema = z.object({
  locked: z.boolean().optional(),
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
}).strict()  // unknown keys = error in strict mode, but we'll catch and warn

const ServiceSchema = z.object({
  plugin: z.string(),
  version: z.string().optional(),
  image: z.string().optional(),
  handler: z.string().optional(),
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
  services: z.record(z.string(), ServiceSchema).optional(),
  apps: z.record(z.string(), AppSchema),
  domains: z.union([z.array(z.string()), z.literal(false)]).optional(),
  env: EnvMapSchema.optional(),
  nginx: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  logs: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
})

export type Config = z.infer<typeof ConfigSchema>
export type AppConfig = z.infer<typeof AppSchema>
export type ServiceConfig = z.infer<typeof ServiceSchema>

export function parseConfig(raw: unknown): Config {
  return ConfigSchema.parse(raw)
}
```

**Step 4: Run tests to verify passing**

```bash
cd src && npx vitest run core/schema.test.ts
```
Expected: 3 passing.

**Step 5: Commit**

```bash
git add src/core/
git commit -m "feat: add Zod config schema with TypeScript types"
```

---

## Task 3: Core — YAML loader

**Files:**
- Create: `src/core/config.ts`
- Create: `src/core/config.test.ts`
- Create: `src/tests/fixtures/simple.yml` (copy from `tests/fixtures/simple.yml`)

**Step 1: Write failing test**

```typescript
// src/core/config.test.ts
import { describe, it, expect } from 'vitest'
import { loadConfig } from './config.js'
import path from 'path'

const FIXTURES = path.join(import.meta.dirname, '../tests/fixtures')

describe('loadConfig', () => {
  it('loads and parses simple.yml', () => {
    const config = loadConfig(path.join(FIXTURES, 'simple.yml'))
    expect(Object.keys(config.apps)).toContain('myapp')
    expect(config.apps['myapp'].ports).toEqual(['http:5000:5000'])
  })

  it('throws on missing file', () => {
    expect(() => loadConfig('/nonexistent.yml')).toThrow(/not found/)
  })

  it('throws on invalid YAML', () => {
    expect(() => loadConfig(path.join(FIXTURES, 'invalid.yml'))).toThrow()
  })
})
```

**Step 2: Run to verify it fails**

```bash
cd src && npx vitest run core/config.test.ts
```

**Step 3: Write `src/core/config.ts`**

```typescript
import * as fs from 'fs'
import * as yaml from 'js-yaml'
import { parseConfig, type Config } from './schema.js'

export function loadConfig(filePath: string): Config {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`)
  }
  const raw = yaml.load(fs.readFileSync(filePath, 'utf8'))
  return parseConfig(raw)
}
```

**Step 4: Copy test fixtures**

```bash
mkdir -p src/tests/fixtures
cp tests/fixtures/simple.yml src/tests/fixtures/
cp tests/fixtures/full.yml src/tests/fixtures/
cp tests/fixtures/invalid.yml src/tests/fixtures/
```

**Step 5: Run tests**

```bash
cd src && npx vitest run core/config.test.ts
```
Expected: 3 passing.

**Step 6: Commit**

```bash
git add src/
git commit -m "feat: add YAML config loader"
```

---

## Task 4: Core — dokku command runner

This is the equivalent of `dokku_cmd` and `dokku_cmd_check` in `lib/core.sh`. It handles local/SSH execution, dry-run mode, and captures output for state queries.

**Files:**
- Create: `src/core/dokku.ts`
- Create: `src/core/dokku.test.ts`

**Step 1: Write failing tests**

```typescript
// src/core/dokku.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRunner } from './dokku.js'

describe('DryRun runner', () => {
  it('records commands without executing', async () => {
    const runner = createRunner({ dryRun: true })
    await runner.run('apps:create', 'myapp')
    expect(runner.dryRunLog).toEqual(['apps:create myapp'])
  })

  it('query() works in dry-run (returns empty string)', async () => {
    const runner = createRunner({ dryRun: true })
    const result = await runner.query('apps:exists', 'myapp')
    expect(result).toBe('')
  })

  it('check() returns false in dry-run', async () => {
    const runner = createRunner({ dryRun: true })
    const ok = await runner.check('apps:exists', 'myapp')
    expect(ok).toBe(false)
  })
})
```

**Step 2: Run to verify it fails**

```bash
cd src && npx vitest run core/dokku.test.ts
```

**Step 3: Write `src/core/dokku.ts`**

```typescript
import { execa } from 'execa'

export interface RunnerOptions {
  host?: string    // DOKKU_HOST for SSH
  dryRun?: boolean
}

export interface Runner {
  /** Execute a mutation command (logged in dry-run) */
  run(...args: string[]): Promise<void>
  /** Execute a read-only command, returns stdout */
  query(...args: string[]): Promise<string>
  /** Execute a read-only command, returns true if exit 0 */
  check(...args: string[]): Promise<boolean>
  /** In dry-run mode, the list of commands that would have run */
  dryRunLog: string[]
}

export function createRunner(opts: RunnerOptions = {}): Runner {
  const log: string[] = []

  async function execDokku(args: string[]): Promise<{ stdout: string; ok: boolean }> {
    if (opts.host) {
      try {
        const result = await execa('ssh', [`dokku@${opts.host}`, ...args])
        return { stdout: result.stdout, ok: true }
      } catch (e: any) {
        return { stdout: e.stdout ?? '', ok: false }
      }
    } else {
      try {
        const result = await execa('dokku', args)
        return { stdout: result.stdout, ok: true }
      } catch (e: any) {
        return { stdout: e.stdout ?? '', ok: false }
      }
    }
  }

  return {
    dryRunLog: log,

    async run(...args: string[]): Promise<void> {
      if (opts.dryRun) {
        log.push(args.join(' '))
        return
      }
      await execDokku(args)
    },

    async query(...args: string[]): Promise<string> {
      if (opts.dryRun) return ''
      const { stdout } = await execDokku(args)
      return stdout.trim()
    },

    async check(...args: string[]): Promise<boolean> {
      if (opts.dryRun) return false
      const { ok } = await execDokku(args)
      return ok
    },
  }
}
```

**Step 4: Run tests**

```bash
cd src && npx vitest run core/dokku.test.ts
```
Expected: 3 passing.

**Step 5: Commit**

```bash
git add src/core/
git commit -m "feat: add dokku command runner with dry-run support"
```

---

## Task 5: Core — logger

Matches the colored output style of the current bash tool.

**Files:**
- Create: `src/core/logger.ts`

No test needed — logger is pure side-effects. Verify visually when running commands.

**Write `src/core/logger.ts`**

```typescript
import chalk from 'chalk'

export function logAction(context: string, message: string): void {
  process.stdout.write(chalk.blue(`[${context.padEnd(12)}]`) + ` ${message}`)
}

export function logDone(): void {
  console.log(`... ${chalk.green('done')}`)
}

export function logSkip(): void {
  console.log(`... ${chalk.yellow('already configured')}`)
}

export function logError(context: string, message: string): void {
  console.error(chalk.red(`[${context.padEnd(12)}] ERROR: ${message}`))
}

export function logWarn(context: string, message: string): void {
  console.warn(chalk.yellow(`[${context.padEnd(12)}] WARN: ${message}`))
}
```

**Commit**

```bash
git add src/core/logger.ts
git commit -m "feat: add colored logger"
```

---

## Task 6: Module — apps

First module to establish the pattern all others follow.

**Files:**
- Create: `src/modules/apps.ts`
- Create: `src/modules/apps.test.ts`

**Step 1: Write failing tests**

```typescript
// src/modules/apps.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { ensureApp, destroyApp, exportApps } from './apps.js'

function dryRunner() { return createRunner({ dryRun: true }) }

describe('ensureApp', () => {
  it('creates app when it does not exist', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = async () => false  // apps:exists returns false
    runner.run = vi.fn()
    await ensureApp(runner, 'myapp')
    expect(runner.run).toHaveBeenCalledWith('apps:create', 'myapp')
  })

  it('skips when app already exists', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = async () => true  // apps:exists returns true
    runner.run = vi.fn()
    await ensureApp(runner, 'myapp')
    expect(runner.run).not.toHaveBeenCalled()
  })
})

describe('destroyApp', () => {
  it('destroys with force when app exists', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = async () => true
    runner.run = vi.fn()
    await destroyApp(runner, 'myapp')
    expect(runner.run).toHaveBeenCalledWith('apps:destroy', 'myapp', '--force')
  })

  it('skips when app does not exist', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = async () => false
    runner.run = vi.fn()
    await destroyApp(runner, 'myapp')
    expect(runner.run).not.toHaveBeenCalled()
  })
})
```

**Step 2: Run to verify it fails**

```bash
cd src && npx vitest run modules/apps.test.ts
```

**Step 3: Write `src/modules/apps.ts`**

```typescript
import type { Runner } from '../core/dokku.js'
import { logAction, logDone, logSkip } from '../core/logger.js'

export async function ensureApp(runner: Runner, app: string): Promise<void> {
  const exists = await runner.check('apps:exists', app)
  logAction(app, 'Creating app')
  if (exists) { logSkip(); return }
  await runner.run('apps:create', app)
  logDone()
}

export async function destroyApp(runner: Runner, app: string): Promise<void> {
  const exists = await runner.check('apps:exists', app)
  logAction(app, 'Destroying app')
  if (!exists) { logSkip(); return }
  await runner.run('apps:destroy', app, '--force')
  logDone()
}

export async function exportApps(runner: Runner): Promise<string[]> {
  const output = await runner.query('apps:list')
  return output.split('\n').map(s => s.trim()).filter(Boolean)
}
```

**Step 4: Run tests**

```bash
cd src && npx vitest run modules/apps.test.ts
```
Expected: 4 passing.

**Step 5: Commit**

```bash
git add src/modules/
git commit -m "feat: add apps module (ensure, destroy, export)"
```

---

## Task 7: Modules — domains, plugins, network

Three modules in one task since they are small and follow the same pattern.

**Files:**
- Create: `src/modules/domains.ts` + `domains.test.ts`
- Create: `src/modules/plugins.ts` + `plugins.test.ts`
- Create: `src/modules/network.ts` + `network.test.ts`

For each module, follow the same TDD pattern as Task 6: write test → run to fail → implement → run to pass.

**Key behaviours to test per module:**

`domains`:
- `ensureAppDomains`: sets domains when config has list; calls `domains:disable` + `domains:clear` when `domains: false`; skips when key absent
- `exportAppDomains(runner, app)`: returns `string[]` from `domains:report <app> --domains-app-vhosts`

`plugins`:
- `ensurePlugins`: installs plugins not yet installed; skips installed ones; updates if version mismatch
- No export needed (plugins are server-level, not per-app)

`network`:
- `ensureNetworks`: creates networks that don't exist; skips existing ones
- `ensureAppNetworks`: sets `attach-post-deploy`
- `exportNetworks(runner)`: returns `string[]` from `network:list`

**Template for each test file:**

```typescript
// src/modules/domains.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { ensureAppDomains } from './domains.js'

describe('ensureAppDomains', () => {
  it('sets domains when list provided', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    await ensureAppDomains(runner, 'myapp', ['example.com', 'www.example.com'])
    expect(runner.run).toHaveBeenCalledWith('domains:enable', 'myapp')
    expect(runner.run).toHaveBeenCalledWith('domains:set', 'myapp', 'example.com', 'www.example.com')
  })

  it('disables and clears when domains: false', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    await ensureAppDomains(runner, 'myapp', false)
    expect(runner.run).toHaveBeenCalledWith('domains:disable', 'myapp')
    expect(runner.run).toHaveBeenCalledWith('domains:clear', 'myapp')
  })

  it('skips when config is undefined', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    await ensureAppDomains(runner, 'myapp', undefined)
    expect(runner.run).not.toHaveBeenCalled()
  })
})
```

**Run all module tests**

```bash
cd src && npx vitest run modules/
```
Expected: all passing.

**Commit**

```bash
git add src/modules/
git commit -m "feat: add domains, plugins, network modules"
```

---

## Task 8: Modules — services (links + convergence)

This is the most complex module because it handles both service creation and the link convergence loop (unlink services that are linked but not in desired config).

**Files:**
- Create: `src/modules/services.ts`
- Create: `src/modules/services.test.ts`

**Key behaviours to test:**

```typescript
// src/modules/services.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { ensureServices, ensureAppLinks } from './services.js'
import type { Config } from '../core/schema.js'

describe('ensureServices', () => {
  it('creates service that does not exist', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = async (cmd: string) => cmd !== 'postgres:exists'
    runner.run = vi.fn()
    const services = { 'api-postgres': { plugin: 'postgres' } }
    await ensureServices(runner, services)
    expect(runner.run).toHaveBeenCalledWith('postgres:create', 'api-postgres')
  })

  it('skips service that exists', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = async () => true  // everything exists
    runner.run = vi.fn()
    await ensureServices(runner, { 'api-postgres': { plugin: 'postgres' } })
    expect(runner.run).not.toHaveBeenCalled()
  })
})

describe('ensureAppLinks', () => {
  it('links desired services not yet linked', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(false)  // nothing linked yet
    runner.run = vi.fn()
    const services = { 'api-postgres': { plugin: 'postgres' } }
    await ensureAppLinks(runner, 'myapp', ['api-postgres'], services)
    expect(runner.run).toHaveBeenCalledWith('postgres:link', 'api-postgres', 'myapp', '--no-restart')
  })

  it('unlinks services linked but not in desired list', async () => {
    const runner = createRunner({ dryRun: false })
    // api-postgres is linked but NOT in desired links
    runner.check = vi.fn().mockImplementation(async (...args: string[]) =>
      args[0] === 'postgres:linked' ? true : false
    )
    runner.run = vi.fn()
    const allServices = { 'api-postgres': { plugin: 'postgres' } }
    await ensureAppLinks(runner, 'myapp', [], allServices)
    expect(runner.run).toHaveBeenCalledWith('postgres:unlink', 'api-postgres', 'myapp', '--no-restart')
  })
})
```

**Run tests, implement, verify, commit**

```bash
cd src && npx vitest run modules/services.test.ts
# implement src/modules/services.ts
cd src && npx vitest run modules/services.test.ts
git add src/modules/services.ts src/modules/services.test.ts
git commit -m "feat: add services module with link convergence"
```

---

## Task 9: Modules — proxy, ports, storage, certs

Four modules with state-query patterns (they read current server state to compute deltas).

**Files:**
- Create: `src/modules/proxy.ts` + `proxy.test.ts`
- Create: `src/modules/ports.ts` + `ports.test.ts`
- Create: `src/modules/storage.ts` + `storage.test.ts`
- Create: `src/modules/certs.ts` + `certs.test.ts`

**Key behaviours per module:**

`ports` — order-insensitive comparison:
```typescript
it('skips when ports already match (different order)', async () => {
  const runner = createRunner({ dryRun: false })
  runner.query = async () => 'https:443:4000 http:80:3000'
  runner.run = vi.fn()
  await ensureAppPorts(runner, 'myapp', ['http:80:3000', 'https:443:4000'])
  expect(runner.run).not.toHaveBeenCalled()
})
```

`storage` — convergence (unmount stale, mount new):
```typescript
it('unmounts stale mounts', async () => {
  const runner = createRunner({ dryRun: false })
  runner.query = async () => '/old/path:/app/old'  // stale
  runner.run = vi.fn()
  await ensureAppStorage(runner, 'myapp', ['/new/path:/app/new'])
  expect(runner.run).toHaveBeenCalledWith('storage:unmount', 'myapp', '/old/path:/app/old')
  expect(runner.run).toHaveBeenCalledWith('storage:mount', 'myapp', '/new/path:/app/new')
})
```

`certs` — ssl: false removes cert, ssl: {certfile, keyfile} adds it:
```typescript
it('skips if ssl already enabled', async () => {
  const runner = createRunner({ dryRun: false })
  runner.query = async () => 'true'  // certs:report --ssl-enabled
  runner.run = vi.fn()
  await ensureAppCerts(runner, 'myapp', { certfile: 'x.crt', keyfile: 'x.key' })
  expect(runner.run).not.toHaveBeenCalled()
})
```

**Run, implement, verify, commit**

```bash
cd src && npx vitest run modules/proxy.test.ts modules/ports.test.ts modules/storage.test.ts modules/certs.test.ts
git add src/modules/
git commit -m "feat: add proxy, ports, storage, certs modules"
```

---

## Task 10: Modules — nginx, checks, logs, registry, scheduler, config

Six modules. `config` is the most complex (env convergence via managed key tracking).

**Files:** One `.ts` + `.test.ts` per module.

**Key behaviour for `config` (env convergence — no prefix required):**

Instead of a prefix convention, dokku-compose stores `DOKKU_COMPOSE_MANAGED_KEYS` as a
comma-separated env var on the app. This records exactly which keys dokku-compose set last
run. On the next run, keys that were previously managed but are no longer declared in the
YAML get unset. Dokku-injected vars (`DATABASE_URL`, `REDIS_URL`, etc.) are never in the
managed set, so they are never touched.

Flow per run:
1. Read `DOKKU_COMPOSE_MANAGED_KEYS` from `config:get APP DOKKU_COMPOSE_MANAGED_KEYS`
2. Compute `to_unset = prev_managed_keys - current_yaml_keys`
3. `config:unset --no-restart APP ...to_unset` (if any)
4. `config:set --no-restart APP KEY=VALUE ... DOKKU_COMPOSE_MANAGED_KEYS=KEY1,KEY2,...`

First run on a fresh app: `DOKKU_COMPOSE_MANAGED_KEYS` is empty, nothing unset. Sets
declared vars and records them. Taking over an existing app behaves the same — pre-existing
vars Dokku injected are never part of the managed set.

```typescript
// src/modules/config.test.ts
it('unsets keys that were managed last run but removed from YAML', async () => {
  const runner = createRunner({ dryRun: false })
  // APP_OLD was managed last run, APP_KEEP is still declared
  runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
    if (args.includes('DOKKU_COMPOSE_MANAGED_KEYS')) return 'APP_OLD,APP_KEEP'
    return ''
  })
  runner.run = vi.fn()
  const desired = { APP_KEEP: 'value' }
  await ensureAppConfig(runner, 'myapp', desired)
  expect(runner.run).toHaveBeenCalledWith(
    'config:unset', '--no-restart', 'myapp', 'APP_OLD'
  )
})

it('never touches Dokku-injected vars not in managed set', async () => {
  const runner = createRunner({ dryRun: false })
  runner.query = vi.fn().mockResolvedValue('')  // no managed keys
  runner.run = vi.fn()
  await ensureAppConfig(runner, 'myapp', { MY_KEY: 'value' })
  const calls = (runner.run as any).mock.calls.map((c: string[]) => c.join(' '))
  expect(calls.some(c => c.includes('DATABASE_URL'))).toBe(false)
})

it('sets vars with any naming convention (no prefix required)', async () => {
  const runner = createRunner({ dryRun: false })
  runner.query = vi.fn().mockResolvedValue('')
  runner.run = vi.fn()
  await ensureAppConfig(runner, 'myapp', {
    SECRET_KEY: 'abc',
    DATABASE_URL_OVERRIDE: 'postgres://custom',
    PORT: '3000',
  })
  expect(runner.run).toHaveBeenCalledWith(
    'config:set', '--no-restart', 'myapp',
    'SECRET_KEY=abc', 'DATABASE_URL_OVERRIDE=postgres://custom', 'PORT=3000',
    expect.stringContaining('DOKKU_COMPOSE_MANAGED_KEYS=')
  )
})
```

**Key behaviour for `checks`:**

```typescript
it('disables all checks when checks: false', async () => {
  const runner = createRunner({ dryRun: false })
  runner.run = vi.fn()
  await ensureAppChecks(runner, 'myapp', false)
  expect(runner.run).toHaveBeenCalledWith('checks:disable', 'myapp')
})
```

**Run all, commit**

```bash
cd src && npx vitest run modules/
git add src/modules/
git commit -m "feat: add nginx, checks, logs, registry, scheduler, config modules"
```

---

## Task 11: Modules — builder, docker-options

**Files:**
- Create: `src/modules/builder.ts` + `builder.test.ts`
- Create: `src/modules/docker-options.ts` + `docker-options.test.ts`

`docker-options` always clears before re-adding (idempotent replacement):

```typescript
it('clears phase before adding options', async () => {
  const runner = createRunner({ dryRun: false })
  runner.run = vi.fn()
  await ensureAppDockerOptions(runner, 'myapp', {
    deploy: ['--restart=always']
  })
  const calls = (runner.run as any).mock.calls.map((c: string[]) => c.join(' '))
  const clearIdx = calls.findIndex((c: string) => c.includes('docker-options:clear'))
  const addIdx = calls.findIndex((c: string) => c.includes('docker-options:add'))
  expect(clearIdx).toBeLessThan(addIdx)
})
```

**Run, implement, commit**

```bash
cd src && npx vitest run modules/builder.test.ts modules/docker-options.test.ts
git add src/modules/
git commit -m "feat: add builder and docker-options modules"
```

---

## Task 12: Command — `up`

Wire all modules together in dependency order, matching the current bash `cmd_up` flow.

**Files:**
- Create: `src/commands/up.ts`
- Create: `src/commands/up.test.ts`

**Step 1: Write integration test using full.yml fixture**

```typescript
// src/commands/up.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { runUp } from './up.js'
import { loadConfig } from '../core/config.js'
import path from 'path'

const FIXTURES = path.join(import.meta.dirname, '../tests/fixtures')

describe('runUp', () => {
  it('creates app and services from simple.yml', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = async () => false  // nothing exists
    runner.run = vi.fn()
    runner.query = async () => ''
    const config = loadConfig(path.join(FIXTURES, 'simple.yml'))
    await runUp(runner, config, [])
    expect(runner.run).toHaveBeenCalledWith('apps:create', 'myapp')
    expect(runner.run).toHaveBeenCalledWith('postgres:create', 'myapp-postgres')
    expect(runner.run).toHaveBeenCalledWith('postgres:link', 'myapp-postgres', 'myapp', '--no-restart')
  })

  it('filters to specific apps when appFilter provided', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = async () => false
    runner.run = vi.fn()
    runner.query = async () => ''
    const config = loadConfig(path.join(FIXTURES, 'full.yml'))
    await runUp(runner, config, ['funqtion'])
    expect(runner.run).toHaveBeenCalledWith('apps:create', 'funqtion')
    expect(runner.run).not.toHaveBeenCalledWith('apps:create', 'studio')
  })
})
```

**Step 2: Implement `src/commands/up.ts`**

```typescript
import type { Runner } from '../core/dokku.js'
import type { Config } from '../core/schema.js'
import { ensureApp, ensureAppLocked } from '../modules/apps.js'
import { ensureAppDomains, ensureGlobalDomains } from '../modules/domains.js'
import { ensurePlugins } from '../modules/plugins.js'
import { ensureNetworks, ensureAppNetworks, ensureAppNetwork } from '../modules/network.js'
import { ensureServices, ensureAppLinks } from '../modules/services.js'
import { ensureAppProxy } from '../modules/proxy.js'
import { ensureAppPorts } from '../modules/ports.js'
import { ensureAppCerts } from '../modules/certs.js'
import { ensureAppStorage } from '../modules/storage.js'
import { ensureAppNginx, ensureGlobalNginx } from '../modules/nginx.js'
import { ensureAppChecks } from '../modules/checks.js'
import { ensureAppLogs, ensureGlobalLogs } from '../modules/logs.js'
import { ensureAppRegistry } from '../modules/registry.js'
import { ensureAppScheduler } from '../modules/scheduler.js'
import { ensureAppConfig, ensureGlobalConfig } from '../modules/config.js'
import { ensureAppBuilder } from '../modules/builder.js'
import { ensureAppDockerOptions } from '../modules/docker-options.js'

export async function runUp(
  runner: Runner,
  config: Config,
  appFilter: string[]
): Promise<void> {
  const apps = appFilter.length > 0
    ? appFilter
    : Object.keys(config.apps)

  // Phase 1: Plugins
  if (config.plugins) await ensurePlugins(runner, config.plugins)

  // Phase 2: Global config
  if (config.domains !== undefined) await ensureGlobalDomains(runner, config.domains)
  if (config.env !== undefined) await ensureGlobalConfig(runner, config.env, )
  if (config.logs !== undefined) await ensureGlobalLogs(runner, config.logs)
  if (config.nginx !== undefined) await ensureGlobalNginx(runner, config.nginx)

  // Phase 3: Networks
  if (config.networks) await ensureNetworks(runner, config.networks)

  // Phase 4: Services
  if (config.services) await ensureServices(runner, config.services)

  // Phase 5: Per-app
  for (const app of apps) {
    const appConfig = config.apps[app]
    if (!appConfig) continue
    await ensureApp(runner, app)
    if (appConfig.locked !== undefined) await ensureAppLocked(runner, app, appConfig.locked)
    await ensureAppDomains(runner, app, appConfig.domains)
    if (config.services) await ensureAppLinks(runner, app, appConfig.links ?? [], config.services)
    await ensureAppNetworks(runner, app, appConfig.networks)
    await ensureAppNetwork(runner, app, appConfig.network)
    if (appConfig.proxy) await ensureAppProxy(runner, app, appConfig.proxy.enabled)
    if (appConfig.ports) await ensureAppPorts(runner, app, appConfig.ports)
    if (appConfig.ssl !== undefined) await ensureAppCerts(runner, app, appConfig.ssl)
    if (appConfig.storage) await ensureAppStorage(runner, app, appConfig.storage)
    if (appConfig.nginx) await ensureAppNginx(runner, app, appConfig.nginx)
    if (appConfig.checks !== undefined) await ensureAppChecks(runner, app, appConfig.checks)
    if (appConfig.logs) await ensureAppLogs(runner, app, appConfig.logs)
    if (appConfig.registry) await ensureAppRegistry(runner, app, appConfig.registry)
    if (appConfig.scheduler) await ensureAppScheduler(runner, app, appConfig.scheduler)
    if (appConfig.env !== undefined) await ensureAppConfig(runner, app, appConfig.env, )
    if (appConfig.build) await ensureAppBuilder(runner, app, appConfig.build)
    if (appConfig.docker_options) await ensureAppDockerOptions(runner, app, appConfig.docker_options)
  }
}
```

**Step 3: Run tests**

```bash
cd src && npx vitest run commands/up.test.ts
```

**Step 4: Commit**

```bash
git add src/commands/
git commit -m "feat: add up command wiring all modules"
```

---

## Task 13: Command — `down`

**Files:**
- Create: `src/commands/down.ts`
- Create: `src/commands/down.test.ts`

Mirror the bash `cmd_down` flow: unlink services, remove certs/storage/domains/ports/network, destroy app, then destroy services and networks.

```typescript
it('destroys app and services in order', async () => {
  const runner = createRunner({ dryRun: false })
  runner.check = async () => true   // everything exists
  runner.query = async () => ''     // no linked apps
  runner.run = vi.fn()
  const config = loadConfig(path.join(FIXTURES, 'simple.yml'))
  await runDown(runner, config, [], { force: true })
  const calls = (runner.run as any).mock.calls.map((c: string[]) => c.join(' '))
  expect(calls.findIndex(c => c.includes('apps:destroy'))).toBeLessThan(
    calls.findIndex(c => c.includes('postgres:destroy'))
  )
})
```

**Run, implement, commit**

```bash
cd src && npx vitest run commands/down.test.ts
git add src/commands/down.ts src/commands/down.test.ts
git commit -m "feat: add down command"
```

---

## Task 14: Command — `ps` and `init`

Small commands, no complex logic.

**Files:**
- Create: `src/commands/ps.ts`
- Create: `src/commands/init.ts`

`ps` queries `apps:exists` + `ps:report` per app and prints status.
`init` writes a starter YAML file (ported from bash `cmd_init`).

**Commit**

```bash
git add src/commands/ps.ts src/commands/init.ts
git commit -m "feat: add ps and init commands"
```

---

## Task 15: Command — `validate`

Offline YAML validation using the Zod schema plus cross-field checks.

**Files:**
- Create: `src/commands/validate.ts`
- Create: `src/commands/validate.test.ts`
- Create: `src/tests/fixtures/invalid_links.yml`
- Create: `src/tests/fixtures/invalid_ports.yml`

**Step 1: Write tests**

```typescript
// src/commands/validate.test.ts
import { describe, it, expect } from 'vitest'
import { validate } from './validate.js'
import path from 'path'

const FIXTURES = path.join(import.meta.dirname, '../tests/fixtures')

describe('validate', () => {
  it('returns no errors for valid simple.yml', () => {
    const result = validate(path.join(FIXTURES, 'simple.yml'))
    expect(result.errors).toHaveLength(0)
  })

  it('returns no errors for valid full.yml', () => {
    const result = validate(path.join(FIXTURES, 'full.yml'))
    expect(result.errors).toHaveLength(0)
  })

  it('errors when app links to undefined service', () => {
    const result = validate(path.join(FIXTURES, 'invalid_links.yml'))
    expect(result.errors.some(e => e.includes('not defined in services'))).toBe(true)
  })

  it('errors on invalid port format', () => {
    const result = validate(path.join(FIXTURES, 'invalid_ports.yml'))
    expect(result.errors.some(e => e.includes('invalid port format') || e.includes('Port must be'))).toBe(true)
  })

  it('warns on unknown top-level keys', () => {
    // Create inline for this test
    const result = validate(path.join(FIXTURES, 'simple.yml'), {
      extraTopLevel: true  // simulated
    })
    // warnings don't fail validation
    expect(result.errors).toHaveLength(0)
  })
})
```

**Step 2: Create invalid fixture files**

`src/tests/fixtures/invalid_links.yml`:
```yaml
apps:
  myapp:
    links:
      - nonexistent-postgres
```

`src/tests/fixtures/invalid_ports.yml`:
```yaml
apps:
  myapp:
    ports:
      - "80:3000"
```

**Step 3: Implement `src/commands/validate.ts`**

```typescript
import * as fs from 'fs'
import * as yaml from 'js-yaml'
import { ConfigSchema } from '../core/schema.js'
import { ZodError } from 'zod'

export interface ValidationResult {
  errors: string[]
  warnings: string[]
}

export function validate(filePath: string): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // 1. File exists
  if (!fs.existsSync(filePath)) {
    return { errors: [`File not found: ${filePath}`], warnings }
  }

  // 2. Valid YAML
  let raw: unknown
  try {
    raw = yaml.load(fs.readFileSync(filePath, 'utf8'))
  } catch (e: any) {
    return { errors: [`YAML parse error: ${e.message}`], warnings }
  }

  // 3. Schema validation (catches type errors, invalid ports, etc.)
  const result = ConfigSchema.safeParse(raw)
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.join('.')
      errors.push(`${path}: ${issue.message}`)
    }
    // Still continue to cross-field checks using raw data
  }

  // 4. Cross-field: service references
  const data = raw as any
  if (data?.apps && data?.services) {
    const serviceNames = new Set(Object.keys(data.services))
    for (const [appName, appCfg] of Object.entries<any>(data.apps)) {
      for (const link of appCfg?.links ?? []) {
        if (!serviceNames.has(link)) {
          errors.push(`apps.${appName}.links: service "${link}" not defined in services`)
        }
      }
    }
  }

  // 5. Cross-field: plugin references (warnings only)
  if (data?.services && data?.plugins) {
    const pluginNames = new Set(Object.keys(data.plugins))
    for (const [svcName, svcCfg] of Object.entries<any>(data.services)) {
      if (svcCfg?.plugin && !pluginNames.has(svcCfg.plugin)) {
        warnings.push(`services.${svcName}.plugin: "${svcCfg.plugin}" not declared in plugins (may be pre-installed)`)
      }
    }
  }

  return { errors, warnings }
}
```

**Step 4: Run tests**

```bash
cd src && npx vitest run commands/validate.test.ts
```
Expected: all passing.

**Step 5: Commit**

```bash
git add src/commands/validate.ts src/commands/validate.test.ts src/tests/fixtures/
git commit -m "feat: add validate command with schema and cross-field checks"
```

---

## Task 16: Export state helpers (one per module)

Each module gets an `exportState(runner, app)` function that queries the server and returns the YAML-shaped data for that feature. These feed both the `export` command and the `diff` engine.

**Files:** Add `export` functions to each existing module file.

**Pattern for each module:**

```typescript
// In src/modules/domains.ts — add:
export async function exportAppDomains(
  runner: Runner, app: string
): Promise<string[] | false | undefined> {
  const raw = await runner.query('domains:report', app, '--domains-app-vhosts')
  const vhosts = raw.split('\n').map(s => s.trim()).filter(Boolean)
  // If empty and vhosts-enabled is false, return false; otherwise return list or undefined
  if (vhosts.length === 0) return undefined
  return vhosts
}
```

**Modules to add export functions to:**

| Module | Query command(s) | Returns |
|--------|-----------------|---------|
| `apps.ts` | `apps:list` | `string[]` |
| `domains.ts` | `domains:report <app> --domains-app-vhosts` | `string[] \| false \| undefined` |
| `config.ts` | `config:export <app>` (or `config:keys` + loop) | `Record<string, string> \| undefined` |
| `ports.ts` | `ports:report <app> --ports-map` | `string[] \| undefined` |
| `proxy.ts` | `proxy:report <app> --proxy-enabled` | `{enabled: boolean} \| undefined` |
| `certs.ts` | `certs:report <app> --ssl-enabled` | `true \| false \| undefined` |
| `storage.ts` | `storage:report <app> --storage-mounts` | `string[] \| undefined` |
| `nginx.ts` | `nginx:report <app>` | `Record<string, string> \| undefined` |
| `checks.ts` | `checks:report <app>` | `ChecksConfig \| undefined` |
| `logs.ts` | `logs:report <app>` | `Record<string, string> \| undefined` |
| `registry.ts` | `registry:report <app>` | `Record<string, string> \| undefined` |
| `scheduler.ts` | `scheduler:report <app> --scheduler-selected` | `string \| undefined` |
| `network.ts` | `network:report <app>` | `{networks?, network?} \| undefined` |
| `services.ts` | `<plugin>:list` per plugin, then `<plugin>:linked <svc> <app>` | `ServiceConfig, string[]` |

**Write tests for each export function following the same pattern:**

```typescript
it('exportAppDomains returns domain list', async () => {
  const runner = createRunner({ dryRun: false })
  runner.query = async () => 'example.com\nwww.example.com'
  const result = await exportAppDomains(runner, 'myapp')
  expect(result).toEqual(['example.com', 'www.example.com'])
})
```

**Run all module tests after adding export functions**

```bash
cd src && npx vitest run modules/
```

**Commit**

```bash
git add src/modules/
git commit -m "feat: add exportState functions to all modules"
```

---

## Task 17: Command — `export`

Assembles module export functions into a complete `dokku-compose.yml`.

**Files:**
- Create: `src/commands/export.ts`
- Create: `src/commands/export.test.ts`

**Step 1: Write test**

```typescript
// src/commands/export.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { runExport } from './export.js'

describe('runExport', () => {
  it('includes app names from apps:list', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'apps:list') return 'myapp'
      if (args[0] === 'domains:report') return 'example.com'
      if (args[0] === 'ports:report') return 'http:80:3000'
      return ''
    })
    runner.check = async () => false
    const result = await runExport(runner, {})
    expect(Object.keys(result.apps)).toContain('myapp')
  })

  it('omits proxy.enabled when true (default)', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockImplementation(async (...args: string[]) => {
      if (args[0] === 'apps:list') return 'myapp'
      if (args.includes('--proxy-enabled')) return 'true'
      return ''
    })
    runner.check = async () => false
    const result = await runExport(runner, {})
    expect(result.apps['myapp']?.proxy).toBeUndefined()
  })
})
```

**Step 2: Implement `src/commands/export.ts`**

```typescript
import type { Runner } from '../core/dokku.js'
import type { Config } from '../core/schema.js'
import { exportApps } from '../modules/apps.js'
import { exportAppDomains } from '../modules/domains.js'
import { exportAppConfig } from '../modules/config.js'
import { exportAppPorts } from '../modules/ports.js'
import { exportAppProxy } from '../modules/proxy.js'
import { exportAppCerts } from '../modules/certs.js'
import { exportAppStorage } from '../modules/storage.js'
import { exportAppNginx } from '../modules/nginx.js'
import { exportAppChecks } from '../modules/checks.js'
import { exportAppLogs } from '../modules/logs.js'
import { exportAppRegistry } from '../modules/registry.js'
import { exportAppScheduler } from '../modules/scheduler.js'
import { exportNetworks } from '../modules/network.js'
import { exportAppNetwork } from '../modules/network.js'
import { exportServices, exportAppLinks } from '../modules/services.js'

export interface ExportOptions {
  appFilter?: string[]
}

export async function runExport(runner: Runner, opts: ExportOptions): Promise<Config> {
  const config: Config = { apps: {} }

  // Apps
  const apps = opts.appFilter?.length ? opts.appFilter : await exportApps(runner)

  // Networks
  const networks = await exportNetworks(runner)
  if (networks.length > 0) config.networks = networks

  // Services
  const services = await exportServices(runner)
  if (Object.keys(services).length > 0) config.services = services

  // Per-app
  for (const app of apps) {
    const appConfig: Config['apps'][string] = {}

    const domains = await exportAppDomains(runner, app)
    if (domains !== undefined) appConfig.domains = domains

    const links = await exportAppLinks(runner, app, services)
    if (links.length > 0) appConfig.links = links

    const ports = await exportAppPorts(runner, app)
    if (ports?.length) appConfig.ports = ports

    const proxy = await exportAppProxy(runner, app)
    if (proxy !== undefined) appConfig.proxy = proxy

    const ssl = await exportAppCerts(runner, app)
    if (ssl !== undefined) appConfig.ssl = ssl

    const storage = await exportAppStorage(runner, app)
    if (storage?.length) appConfig.storage = storage

    const nginx = await exportAppNginx(runner, app)
    if (nginx && Object.keys(nginx).length) appConfig.nginx = nginx

    const checks = await exportAppChecks(runner, app)
    if (checks !== undefined) appConfig.checks = checks

    const logs = await exportAppLogs(runner, app)
    if (logs && Object.keys(logs).length) appConfig.logs = logs

    const registry = await exportAppRegistry(runner, app)
    if (registry && Object.keys(registry).length) appConfig.registry = registry

    const scheduler = await exportAppScheduler(runner, app)
    if (scheduler) appConfig.scheduler = scheduler

    const networkCfg = await exportAppNetwork(runner, app)
    if (networkCfg?.networks?.length) appConfig.networks = networkCfg.networks
    if (networkCfg?.network) appConfig.network = networkCfg.network

    const env = await exportAppConfig(runner, app)
    if (env && Object.keys(env).length) appConfig.env = env

    config.apps[app] = appConfig
  }

  return config
}
```

**Step 3: Run tests**

```bash
cd src && npx vitest run commands/export.test.ts
```

**Step 4: Commit**

```bash
git add src/commands/export.ts src/commands/export.test.ts
git commit -m "feat: add export command"
```

---

## Task 18: Command — `diff`

Compare local config (desired) against `runExport` output (current). Two output modes.

**Files:**
- Create: `src/commands/diff.ts`
- Create: `src/commands/diff.test.ts`

**Step 1: Write tests**

```typescript
// src/commands/diff.test.ts
import { describe, it, expect } from 'vitest'
import { computeDiff, formatSummary, formatVerbose } from './diff.js'
import type { Config } from '../core/schema.js'

const desired: Config = {
  apps: {
    api: {
      ports: ['http:80:3000'],
      domains: ['api.example.com'],
    }
  }
}

const current: Config = {
  apps: {
    api: {
      ports: ['http:80:4000'],  // different
      // domains missing
    }
  }
}

describe('computeDiff', () => {
  it('detects port change', () => {
    const diff = computeDiff(desired, current)
    expect(diff.apps['api'].ports?.status).toBe('changed')
  })

  it('detects missing domain', () => {
    const diff = computeDiff(desired, current)
    expect(diff.apps['api'].domains?.status).toBe('missing')
  })

  it('reports in-sync when identical', () => {
    const diff = computeDiff(desired, desired)
    expect(diff.inSync).toBe(true)
  })
})

describe('formatSummary', () => {
  it('shows changed and missing items', () => {
    const diff = computeDiff(desired, current)
    const output = formatSummary(diff)
    expect(output).toContain('api')
    expect(output).toContain('ports')
    expect(output).toContain('domains')
  })
})

describe('formatVerbose', () => {
  it('shows +/- lines', () => {
    const diff = computeDiff(desired, current)
    const output = formatVerbose(diff)
    expect(output).toContain('+')
    expect(output).toContain('-')
  })
})
```

**Step 2: Implement `src/commands/diff.ts`**

```typescript
import type { Config, AppConfig } from '../core/schema.js'
import chalk from 'chalk'

type DiffStatus = 'in-sync' | 'changed' | 'missing' | 'extra'

interface FeatureDiff {
  status: DiffStatus
  desired?: unknown
  current?: unknown
}

interface AppDiff {
  [feature: string]: FeatureDiff
}

interface DiffResult {
  apps: Record<string, AppDiff>
  services: Record<string, { status: DiffStatus }>
  inSync: boolean
}

export function computeDiff(desired: Config, current: Config): DiffResult {
  const result: DiffResult = { apps: {}, services: {}, inSync: true }

  // Compare per-app features
  for (const [app, desiredApp] of Object.entries(desired.apps)) {
    const currentApp = current.apps[app] ?? {}
    const appDiff: AppDiff = {}

    const features: Array<keyof AppConfig> = [
      'domains', 'ports', 'env', 'ssl', 'storage',
      'nginx', 'logs', 'registry', 'scheduler', 'checks',
      'networks', 'proxy', 'links'
    ]

    for (const feature of features) {
      const d = desiredApp[feature]
      const c = currentApp[feature as keyof typeof currentApp]
      if (d === undefined) continue  // not declared = don't diff

      const dStr = JSON.stringify(d)
      const cStr = JSON.stringify(c)

      if (cStr === undefined || c === undefined) {
        appDiff[feature] = { status: 'missing', desired: d, current: undefined }
        result.inSync = false
      } else if (dStr !== cStr) {
        appDiff[feature] = { status: 'changed', desired: d, current: c }
        result.inSync = false
      } else {
        appDiff[feature] = { status: 'in-sync', desired: d, current: c }
      }
    }
    result.apps[app] = appDiff
  }

  // Compare services
  for (const [svc, desiredSvc] of Object.entries(desired.services ?? {})) {
    const exists = current.services?.[svc]
    if (!exists) {
      result.services[svc] = { status: 'missing' }
      result.inSync = false
    } else {
      result.services[svc] = { status: 'in-sync' }
    }
  }

  return result
}

export function formatSummary(diff: DiffResult): string {
  const lines: string[] = ['']

  for (const [app, appDiff] of Object.entries(diff.apps)) {
    const changes = Object.entries(appDiff).filter(([, d]) => d.status !== 'in-sync')
    if (changes.length === 0) {
      lines.push(`  app: ${app}`)
      lines.push(`    (in sync)`)
    } else {
      lines.push(`  app: ${chalk.bold(app)}`)
      for (const [feature, d] of changes) {
        const sym = d.status === 'missing' ? chalk.green('+') : chalk.yellow('~')
        lines.push(`    ${sym} ${feature}: ${formatFeatureSummary(d)}`)
      }
    }
  }

  for (const [svc, d] of Object.entries(diff.services)) {
    if (d.status === 'missing') {
      lines.push(`  services:`)
      lines.push(`    ${chalk.green('+')} ${svc}: not provisioned`)
    }
  }

  const total = Object.values(diff.apps)
    .flatMap(a => Object.values(a))
    .filter(d => d.status !== 'in-sync').length +
    Object.values(diff.services).filter(d => d.status !== 'in-sync').length

  lines.push('')
  if (total === 0) {
    lines.push(chalk.green('  Everything in sync.'))
  } else {
    lines.push(chalk.yellow(`  ${total} resource(s) out of sync.`))
  }
  lines.push('')
  return lines.join('\n')
}

function formatFeatureSummary(d: FeatureDiff): string {
  if (d.status === 'missing') return '(not set on server)'
  if (Array.isArray(d.desired) && Array.isArray(d.current)) {
    return `${(d.current as unknown[]).length} → ${(d.desired as unknown[]).length} items`
  }
  return `${JSON.stringify(d.current)} → ${JSON.stringify(d.desired)}`
}

export function formatVerbose(diff: DiffResult): string {
  const lines: string[] = ['']

  for (const [app, appDiff] of Object.entries(diff.apps)) {
    const changes = Object.entries(appDiff).filter(([, d]) => d.status !== 'in-sync')
    if (changes.length === 0) continue

    for (const [feature, d] of changes) {
      lines.push(`@@ app: ${app} / ${feature} @@`)
      const current = d.current !== undefined ? JSON.stringify(d.current, null, 2).split('\n') : []
      const desired = JSON.stringify(d.desired, null, 2).split('\n')
      for (const line of current) lines.push(chalk.red(`- ${line}`))
      for (const line of desired) lines.push(chalk.green(`+ ${line}`))
    }
  }

  for (const [svc, d] of Object.entries(diff.services)) {
    if (d.status === 'missing') {
      lines.push(`@@ services @@`)
      lines.push(chalk.green(`+ ${svc}`))
    }
  }

  lines.push('')
  return lines.join('\n')
}
```

**Step 3: Run tests**

```bash
cd src && npx vitest run commands/diff.test.ts
```
Expected: all passing.

**Step 4: Commit**

```bash
git add src/commands/diff.ts src/commands/diff.test.ts
git commit -m "feat: add diff command with summary and verbose formatters"
```

---

## Task 19: CLI entry point

Wire all commands into a Commander.js CLI.

**Files:**
- Create: `src/index.ts`

**Write `src/index.ts`**

```typescript
#!/usr/bin/env node
import { Command } from 'commander'
import * as fs from 'fs'
import * as yaml from 'js-yaml'
import { loadConfig } from './core/config.js'
import { createRunner } from './core/dokku.js'
import { runUp } from './commands/up.js'
import { runDown } from './commands/down.js'
import { runExport } from './commands/export.js'
import { computeDiff, formatSummary, formatVerbose } from './commands/diff.js'
import { validate } from './commands/validate.js'

const program = new Command()
  .name('dokku-compose')
  .version('0.3.0')

function makeRunner(opts: { dryRun?: boolean }) {
  return createRunner({
    host: process.env.DOKKU_HOST,
    dryRun: opts.dryRun ?? false,
  })
}

program
  .command('up [apps...]')
  .description('Create/update apps and services to match config')
  .option('-f, --file <path>', 'Config file', 'dokku-compose.yml')
  .option('--dry-run', 'Print commands without executing')
  .option('--fail-fast', 'Stop on first error')
  .action(async (apps, opts) => {
    const config = loadConfig(opts.file)
    const runner = makeRunner(opts)
    await runUp(runner, config, apps)
    if (opts.dryRun) {
      console.log('\n# Commands that would run:')
      for (const cmd of runner.dryRunLog) console.log(`dokku ${cmd}`)
    }
  })

program
  .command('down [apps...]')
  .description('Destroy apps and services (requires --force)')
  .option('-f, --file <path>', 'Config file', 'dokku-compose.yml')
  .option('--force', 'Required to destroy apps')
  .action(async (apps, opts) => {
    if (!opts.force) { console.error('--force required'); process.exit(1) }
    const config = loadConfig(opts.file)
    const runner = makeRunner({})
    await runDown(runner, config, apps, { force: true })
  })

program
  .command('validate [file]')
  .description('Validate dokku-compose.yml without touching the server')
  .action((file = 'dokku-compose.yml') => {
    const result = validate(file)
    for (const w of result.warnings) console.warn(`WARN:  ${w}`)
    for (const e of result.errors) console.error(`ERROR: ${e}`)
    if (result.errors.length > 0) {
      console.error(`\n${result.errors.length} error(s), ${result.warnings.length} warning(s)`)
      process.exit(1)
    }
    if (result.warnings.length > 0) {
      console.log(`\n0 errors, ${result.warnings.length} warning(s)`)
    } else {
      console.log('Valid.')
    }
  })

program
  .command('export')
  .description('Export server state to dokku-compose.yml format')
  .option('-f, --file <path>', 'Config file to scope export against')
  .option('-o, --output <path>', 'Write to file instead of stdout')
  .option('--app <app>', 'Export only a specific app')
  .action(async (opts) => {
    const runner = makeRunner({})
    const result = await runExport(runner, {
      appFilter: opts.app ? [opts.app] : undefined
    })
    const out = yaml.dump(result, { lineWidth: 120 })
    if (opts.output) {
      fs.writeFileSync(opts.output, out)
      console.error(`Written to ${opts.output}`)
    } else {
      process.stdout.write(out)
    }
  })

program
  .command('diff')
  .description('Show what is out of sync between config and server')
  .option('-f, --file <path>', 'Config file', 'dokku-compose.yml')
  .option('--verbose', 'Show git-style +/- diff')
  .action(async (opts) => {
    const desired = loadConfig(opts.file)
    const runner = makeRunner({})
    const current = await runExport(runner, {
      appFilter: Object.keys(desired.apps)
    })
    const diff = computeDiff(desired, current)
    const output = opts.verbose ? formatVerbose(diff) : formatSummary(diff)
    process.stdout.write(output)
    process.exit(diff.inSync ? 0 : 1)
  })

program
  .command('ps [apps...]')
  .description('Show status of configured apps')
  .option('-f, --file <path>', 'Config file', 'dokku-compose.yml')
  .action(async (apps, opts) => {
    const config = loadConfig(opts.file)
    const runner = makeRunner({})
    const { runPs } = await import('./commands/ps.js')
    await runPs(runner, config, apps)
  })

program
  .command('init [apps...]')
  .description('Create a starter dokku-compose.yml')
  .option('-f, --file <path>', 'Config file', 'dokku-compose.yml')
  .action((apps, opts) => {
    const { runInit } = require('./commands/init.js')
    runInit(opts.file, apps)
  })

program.parse()
```

**Smoke-test the CLI**

```bash
cd src && npx tsx index.ts --help
```
Expected: usage printed, no errors.

**Commit**

```bash
git add src/index.ts
git commit -m "feat: add Commander.js CLI entry point"
```

---

## Task 20: Replace bash entry point

Update `bin/dokku-compose` to delegate to the TypeScript CLI. Keep bash as a thin shim during transition.

**Step 1: Update `bin/dokku-compose`**

```bash
#!/usr/bin/env bash
# Delegate to TypeScript implementation
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "${SCRIPT_DIR}/../src/dist/index.js" "$@"
```

Or for development (no build step):
```bash
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec npx --yes tsx "${SCRIPT_DIR}/../src/index.ts" "$@"
```

**Step 2: Build**

```bash
cd src && npm run build
```

**Step 3: Smoke test end-to-end**

```bash
./bin/dokku-compose --help
./bin/dokku-compose validate tests/fixtures/simple.yml
./bin/dokku-compose validate tests/fixtures/full.yml
```
Expected: valid output, no errors.

**Step 4: Run full test suite**

```bash
cd src && npx vitest run
```
Expected: all passing.

**Step 5: Commit**

```bash
git add bin/dokku-compose src/dist/
git commit -m "feat: wire bin/dokku-compose to TypeScript CLI"
```

---

## Task 21: Update package.json and README

**Step 1: Update root-level package metadata if needed**

Add to `src/package.json`:
```json
{
  "name": "dokku-compose",
  "bin": {
    "dokku-compose": "./dist/index.js"
  }
}
```

**Step 2: Run all tests one final time**

```bash
cd src && npx vitest run
```
Expected: all passing, 0 failures.

**Step 3: Final commit**

```bash
git add .
git commit -m "feat: complete TypeScript rewrite with validate, export, diff commands"
```

---

## Appendix: Module function signatures reference

Each module exports the following function shapes (use as contract when implementing):

```typescript
// ensure functions — called by up command
ensureApp(runner, app): Promise<void>
ensureAppDomains(runner, app, config: string[] | false | undefined): Promise<void>
ensurePlugins(runner, plugins: Record<string, PluginConfig>): Promise<void>
ensureNetworks(runner, networks: string[]): Promise<void>
ensureAppNetworks(runner, app, networks: string[] | undefined): Promise<void>
ensureServices(runner, services: Record<string, ServiceConfig>): Promise<void>
ensureAppLinks(runner, app, links: string[], allServices: Record<string, ServiceConfig>): Promise<void>
ensureAppProxy(runner, app, enabled: boolean): Promise<void>
ensureAppPorts(runner, app, ports: string[]): Promise<void>
ensureAppCerts(runner, app, ssl: SslConfig): Promise<void>
ensureAppStorage(runner, app, storage: string[]): Promise<void>
ensureAppNginx(runner, app, nginx: Record<string, string | number>): Promise<void>
ensureAppChecks(runner, app, checks: ChecksConfig | false): Promise<void>
ensureAppLogs(runner, app, logs: Record<string, string | number>): Promise<void>
ensureAppRegistry(runner, app, registry: Record<string, string | boolean>): Promise<void>
ensureAppScheduler(runner, app, scheduler: string): Promise<void>
ensureAppConfig(runner, app, env: EnvMap): Promise<void>
ensureAppBuilder(runner, app, build: BuildConfig): Promise<void>
ensureAppDockerOptions(runner, app, options: DockerOptionsConfig): Promise<void>

// destroy functions — called by down command
destroyApp(runner, app): Promise<void>
destroyAppLinks(runner, app, links, services): Promise<void>
destroyServices(runner, services): Promise<void>
destroyNetworks(runner, networks): Promise<void>

// export functions — called by export/diff commands
exportApps(runner): Promise<string[]>
exportAppDomains(runner, app): Promise<string[] | false | undefined>
exportNetworks(runner): Promise<string[]>
exportServices(runner): Promise<Record<string, ServiceConfig>>
exportAppLinks(runner, app, services): Promise<string[]>
exportAppPorts(runner, app): Promise<string[] | undefined>
exportAppProxy(runner, app): Promise<{enabled: boolean} | undefined>
exportAppCerts(runner, app): Promise<true | false | undefined>
exportAppStorage(runner, app): Promise<string[] | undefined>
exportAppNginx(runner, app): Promise<Record<string, string> | undefined>
exportAppChecks(runner, app): Promise<ChecksConfig | undefined>
exportAppLogs(runner, app): Promise<Record<string, string> | undefined>
exportAppRegistry(runner, app): Promise<Record<string, string> | undefined>
exportAppScheduler(runner, app): Promise<string | undefined>
exportAppConfig(runner, app): Promise<Record<string, string> | undefined>
```
