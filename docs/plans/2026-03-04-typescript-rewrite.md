# TypeScript Rewrite Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite dokku-compose from bash to TypeScript — port all existing modules, add new `validate`, `export`, and `diff` commands.

**Architecture:** Commander.js CLI with Zod-validated YAML config, per-module `ensure`/`destroy`/`exportState` functions, and a shared `dokku()` command runner supporting local/SSH/dry-run modes. Each module is a standalone file exporting a standard interface. The diff engine compares typed config objects (desired vs exported server state).

**Tech Stack:** TypeScript, Node.js >= 18, Commander.js (CLI), Zod (schema/validation), js-yaml (YAML parsing), chalk (colors), vitest (tests), tsup (build)

---

## Project Structure

```
src/
  index.ts                  # CLI entry point (Commander.js)
  core/
    dokku.ts                # dokku command runner (local/ssh/dry-run)
    config.ts               # YAML loading + Zod schema + typed config
    logger.ts               # Colored logging (matches current style)
    types.ts                # Zod schemas + inferred types
    context.ts              # Context factory (bundles dokku + logger)
  modules/
    apps.ts                 # App create/destroy/export
    domains.ts              # Domain configuration
    config.ts               # Environment variables
    services.ts             # Service instances + links + handlers
    plugins.ts              # Plugin installation
    network.ts              # Docker networks + per-app network settings
    proxy.ts                # Proxy enable/disable
    ports.ts                # Port mappings
    certs.ts                # SSL certificates
    storage.ts              # Persistent storage
    nginx.ts                # Nginx properties
    checks.ts               # Zero-downtime checks
    logs.ts                 # Log management
    registry.ts             # Registry management
    scheduler.ts            # Scheduler selection
    builder.ts              # Dockerfile builder + build args
    docker-options.ts       # Per-phase Docker options
    dokku-version.ts        # Version check/install
  commands/
    up.ts                   # Up command orchestration
    down.ts                 # Down command
    ps.ts                   # Status display
    init.ts                 # Create starter YAML
    setup.ts                # Install dokku
    validate.ts             # YAML validation (NEW)
    export.ts               # Server state -> YAML (NEW)
    diff.ts                 # Compare YAML vs server (NEW)
tests/
  helpers.ts                # Mock context factory
  core/
    dokku.test.ts
    config.test.ts
    logger.test.ts
  modules/
    apps.test.ts
    domains.test.ts
    ... (one per module)
  commands/
    up.test.ts
    down.test.ts
    validate.test.ts
    export.test.ts
    diff.test.ts
  fixtures/
    simple.yml
    full.yml
    ... (port existing fixtures)
```

## Module Interface

Every module in `src/modules/` exports this standard shape:

```typescript
export async function ensure(app: string, appConfig: AppConfig, ctx: Context): Promise<void>
export async function destroy(app: string, appConfig: AppConfig, ctx: Context): Promise<void>
export async function exportState(app: string, ctx: Context): Promise<Partial<AppConfig>>

// Some modules have global variants:
export async function ensureGlobal(config: Config, ctx: Context): Promise<void>
export async function exportGlobalState(ctx: Context): Promise<Partial<Config>>
```

Where `Context` carries the shared state:

```typescript
interface Context {
  dokku: {
    cmd(...args: string[]): Promise<string>        // mutation (logged)
    check(...args: string[]): Promise<boolean>      // query: exit code -> bool
    query(...args: string[]): Promise<string>       // query: returns stdout
  }
  log: Logger
  dryRun: boolean
  failFast: boolean
}
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `tsup.config.ts`
- Modify: `.gitignore`

**Step 1: Initialize and install**

```bash
npm init -y
npm install commander chalk js-yaml zod
npm install -D typescript tsx tsup vitest @types/js-yaml @types/node
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**Step 3: Create vitest.config.ts, tsup.config.ts, update .gitignore**

**Step 4: Commit**

```bash
git commit -m "feat: initialize TypeScript project scaffold"
```

---

## Task 2: Core - Logger

**Files:**
- Create: `src/core/logger.ts`
- Test: `tests/core/logger.test.ts`

Port the logging from `lib/core.sh` lines 10-50. Match the existing output format:
- `[context     ] message... done` (green)
- `[context     ] message... already configured` (yellow)
- `[context     ] ERROR: message` (red)
- `[context     ] WARN: message` (yellow)

Use chalk for colors, with a `write` option for testability (default: `process.stderr.write`).

**Tests:** action+done, action+skip, error increments count, warn output, color=false for testing.

```bash
git commit -m "feat: add logger module"
```

---

## Task 3: Core - Dokku Command Runner

**Files:**
- Create: `src/core/dokku.ts`
- Test: `tests/core/dokku.test.ts`

Port `dokku_cmd` and `dokku_cmd_check` from `lib/core.sh` lines 54-71.

Three methods:
- `cmd(...args)` — mutation, respects dry-run, logs `[dry-run] dokku ...`
- `check(...args)` — returns `boolean` from exit code (true=0, false=non-zero)
- `query(...args)` — returns trimmed stdout

Supports: local (`dokku` binary), SSH (`ssh dokku@HOST`), dry-run.

**Tests:** dry-run returns string, check returns bool, query returns stdout, SSH prefixes command.

```bash
git commit -m "feat: add dokku command runner"
```

---

## Task 4: Core - Types + Config Schema + YAML Loader

**Files:**
- Create: `src/core/types.ts`, `src/core/config.ts`
- Test: `tests/core/config.test.ts`
- Copy: `tests/fixtures/simple.yml`, `tests/fixtures/full.yml` (from existing)

Define Zod schemas matching the current YAML format (see `tests/fixtures/full.yml` for reference). Key schemas:

| Schema | Validates | Notes |
|--------|-----------|-------|
| `PortSchema` | `scheme:host:container` | Regex: `/^(https?|grpc[s]?):(\d+):(\d+)$/` |
| `AppConfigSchema` | Per-app config | `.passthrough()` for unknown keys (warn, don't error) |
| `ServiceConfigSchema` | `plugin`, `version`, `image`, `handler` | |
| `ConfigSchema` | Top-level | `.passthrough()` for unknown keys |

`loadConfig(path)` — reads YAML file, parses with Zod.
`validateConfig(config)` — returns `{ errors: string[], warnings: string[] }`:
- Unknown top-level keys → warning
- Link to undefined service → error
- Invalid port format → error
- Service plugin not in plugins → warning

**Tests:** loads simple.yml, loads full.yml, throws on missing file, validates good config, catches bad ports, catches missing service refs.

```bash
git commit -m "feat: add Zod config schema, YAML loader, and validator"
```

---

## Task 5: Core - Context + Test Helpers

**Files:**
- Create: `src/core/context.ts`
- Create: `tests/helpers.ts`

Context factory ties together dokku runner + logger.

Test helper `createMockContext()` returns a `MockContext` with:
- `calls: string[]` — records all `dokku.cmd()` calls
- `mockCheck(cmd, result)` — set check return value
- `mockQuery(cmd, result)` — set query return value

This replaces the bash `setup_mocks`/`mock_dokku_exit`/`mock_dokku_output`/`assert_dokku_called` pattern from `tests/test_helper.bash`.

```bash
git commit -m "feat: add context factory and mock test helpers"
```

---

## Tasks 6-15: Port Modules

Each module follows the same pattern:
1. Read the bash source in `lib/<module>.sh`
2. Write failing tests in `tests/modules/<module>.test.ts` using `createMockContext()`
3. Implement in `src/modules/<module>.ts`
4. Add `exportState()` function that queries server state
5. Verify tests pass, commit

### Task 6: Apps (`lib/apps.sh`)

Port: `ensure_app`, `destroy_app`, `ensure_app_locked`, `show_app_status`

Key: `apps:exists` check → `apps:create` or skip. `locked: true` → `apps:lock`. Export: `apps:report` for locked status.

```bash
git commit -m "feat: port apps module to TypeScript"
```

### Task 7: Domains (`lib/domains.sh`)

Port: `ensure_app_domains`, `destroy_app_domains`, `ensure_global_domains`

Key: `domains: false` → disable+clear. `domains: [list]` → enable+set. Global uses `--all`/`--global` flags. Export: `domains:report APP`.

```bash
git commit -m "feat: port domains module to TypeScript"
```

### Task 8: Config / Env Vars (`lib/config.sh`)

Port: `ensure_app_config`, `ensure_global_config`, convergence logic

Key: Sets vars with `config:set --no-restart`. Converges orphaned vars matching prefix. Respects `dokku.env_prefix`. `env: false` → unset all. `${VAR}` expansion. Export: `config:keys` + `config:get` per key.

```bash
git commit -m "feat: port config (env vars) module to TypeScript"
```

### Task 9: Services + Links (`lib/services.sh`)

Port: `ensure_services`, `ensure_app_links`, `ensure_app_handlers`, `destroy_services`, `destroy_app_links`, `destroy_app_handlers`

Key: Creates services via `<plugin>:create` with version/image flags. Links/unlinks with convergence. Handler services run custom scripts. Destroy only if no apps linked. Export: `<plugin>:list` + `<plugin>:linked` per service+app.

```bash
git commit -m "feat: port services and links module to TypeScript"
```

### Task 10: Plugins (`lib/plugins.sh`)

Port: `ensure_plugins`

Key: Install with URL + optional committish. Update on version mismatch. Export: `plugin:list` → parse name/version.

```bash
git commit -m "feat: port plugins module to TypeScript"
```

### Task 11: Network (`lib/network.sh`)

Port: `ensure_networks`, `ensure_app_networks`, `ensure_app_network`, `destroy_networks`, `destroy_app_network`

Key: Creates shared networks. Attaches apps via `attach-post-deploy`. Per-app settings: `attach_post_create`, `initial_network`, `bind_all_interfaces`, `tld`. `false` clears. Export: `network:report APP`.

```bash
git commit -m "feat: port network module to TypeScript"
```

### Task 12: Ports + Proxy + Certs + Storage

Port four simpler modules together:

| Module | Source | Ensure | Export |
|--------|--------|--------|--------|
| ports | `lib/ports.sh` | Order-insensitive set | `ports:report APP --ports-map` |
| proxy | `lib/proxy.sh` | Enable/disable | `proxy:report APP --proxy-enabled` |
| certs | `lib/certs.sh` | Add cert files, `false` removes | `certs:report APP --ssl-enabled` → `ssl: true` |
| storage | `lib/storage.sh` | Mount/unmount convergence | `storage:report APP --storage-mounts` |

```bash
git commit -m "feat: port ports, proxy, certs, and storage modules"
```

### Task 13: Nginx + Logs + Registry + Scheduler

Port four property-based modules together (they all use the `set_properties` pattern):

| Module | Source | Global? | Export |
|--------|--------|---------|--------|
| nginx | `lib/nginx.sh` | Yes | `nginx:report APP` |
| logs | `lib/logs.sh` | Yes | `logs:report APP` |
| registry | `lib/registry.sh` | No | `registry:report APP` |
| scheduler | `lib/scheduler.sh` | No | `scheduler:report APP --scheduler-selected` |

```bash
git commit -m "feat: port nginx, logs, registry, and scheduler modules"
```

### Task 14: Checks + Builder + Docker Options

Port three complex modules:

| Module | Source | Special |
|--------|--------|---------|
| checks | `lib/checks.sh` | Reserved keys (`disabled`, `skipped`), `false` disables all |
| builder | `lib/builder.sh` | Multiple namespaces: `builder-dockerfile:set`, `builder:set`, `app-json:set` |
| docker_options | `lib/docker_options.sh` | Clear+add per phase |

```bash
git commit -m "feat: port checks, builder, and docker-options modules"
```

### Task 15: Dokku Version (`lib/dokku.sh`)

Port: `ensure_dokku_version` (warn on mismatch), `install_dokku`

```bash
git commit -m "feat: port dokku version module"
```

---

## Task 16: Command - Up

**Files:**
- Create: `src/commands/up.ts`
- Test: `tests/commands/up.test.ts`

Port `cmd_up` orchestration from `bin/dokku-compose` lines 124-184:

1. Version check → Plugins → Global config (domains, env, logs, nginx) → Networks → Services
2. Per-app in order: app → locked → domains → links → handlers → networks → network → proxy → ports → certs → storage → nginx → checks → logs → registry → scheduler → config → builder → docker_options
3. Respects `--dry-run`, `--fail-fast`, app filter
4. Error counting and summary

```bash
git commit -m "feat: implement up command orchestration"
```

---

## Task 17: Command - Down

**Files:**
- Create: `src/commands/down.ts`
- Test: `tests/commands/down.test.ts`

Port `cmd_down` from `bin/dokku-compose` lines 212-263:
1. Requires `--force`
2. Per-app: unlink → handlers(down) → certs → storage → domains → ports → network → nginx → destroy
3. Destroy services (only if no apps linked)
4. Destroy networks

```bash
git commit -m "feat: implement down command"
```

---

## Task 18: Command - Validate (NEW)

**Files:**
- Create: `src/commands/validate.ts`
- Test: `tests/commands/validate.test.ts`

Wire `validateConfig()` from Task 4 into a CLI command:
- Load YAML (catch parse errors)
- Run validation
- Print errors/warnings with colored output matching design doc format
- Exit code: 0 = valid, 1 = errors found

```
dokku-compose validate

  ERROR: apps.api.links[0]: service "api-postgres" not defined in services
  WARN:  services.api-redis.plugin: plugin "redis" not declared in plugins

  1 error, 1 warning
```

```bash
git commit -m "feat: implement validate command"
```

---

## Task 19: Command - Export (NEW)

**Files:**
- Create: `src/commands/export.ts`
- Test: `tests/commands/export.test.ts`

Per the design doc (`docs/plans/2026-03-04-new-cli-commands-design.md`):

1. Query `version` → `.dokku.version`
2. Query `plugin:list` → `.plugins`
3. Query known service plugins → `.services`
4. Query `apps:list` → for each app, call `exportState()` on every module
5. Discover links: O(services x apps) via `<plugin>:linked`
6. Query global state (domains, env, nginx, logs)
7. Omit default values to keep YAML clean
8. SSL: emit `ssl: true` marker (can't export cert files)
9. Config: export ALL env vars
10. Serialize to YAML via `js-yaml`, write to stdout or file (`-o`)

```bash
git commit -m "feat: implement export command"
```

---

## Task 20: Command - Diff (NEW)

**Files:**
- Create: `src/commands/diff.ts`
- Create: `src/core/differ.ts` (comparison engine)
- Test: `tests/commands/diff.test.ts`, `tests/core/differ.test.ts`

Per the design doc:

**Differ engine** (`src/core/differ.ts`):

```typescript
interface DiffEntry {
  path: string          // "apps.api.config", "services.api-pg"
  type: '+' | '~' | '-'  // add, change, remove
  summary: string       // "3 vars differ"
  details?: string[]    // verbose: per-line +/- diffs
}

function diffConfigs(desired: Config, current: Config): DiffEntry[]
```

Only diffs what's declared in YAML (decision #4).

**Two formatters:**

Default summary:
```
  app: api
    ~ config:  3 vars differ
    + domains: api.example.com (not set)
  services:
    + api-postgres: not provisioned
  3 resources out of sync.
```

`--verbose` git-style:
```
--- server (current)
+++ dokku-compose.yml (desired)
@@ app: api / config @@
- DATABASE_URL=postgres://old-host/db
+ DATABASE_URL=postgres://new-host/db
```

**Exit codes:** 0 = in sync, 1 = differences, 2 = error

```bash
git commit -m "feat: implement diff command with summary and verbose modes"
```

---

## Task 21: Commands - PS, Init, Setup

**Files:**
- Create: `src/commands/ps.ts`, `src/commands/init.ts`, `src/commands/setup.ts`
- Test: corresponding test files

Port simpler commands:
- `ps`: `apps:exists` check + `ps:report APP --status-message`
- `init`: create starter `dokku-compose.yml` (empty or with named apps)
- `setup`: install dokku (delegates to dokku-version module)

```bash
git commit -m "feat: port ps, init, and setup commands"
```

---

## Task 22: CLI Entry Point

**Files:**
- Create: `src/index.ts`
- Test: `tests/cli.test.ts`

Wire all commands with Commander.js. Match current CLI interface:

```
dokku-compose <command> [options] [app-name...]

Commands: init, up, down, ps, setup, validate, export, diff

Options:
  --file <path>     Config file (default: dokku-compose.yml)
  --dry-run         Print commands without executing
  --fail-fast       Stop on first error
  --force           Required for down
  --remove-orphans  Destroy services/networks not in config
```

New commands:
```
validate [file]
export [-o file] [--app name]
diff [--verbose] [--file path]
```

```bash
git commit -m "feat: wire CLI entry point with Commander.js"
```

---

## Task 23: Build + Distribution

**Step 1:** `npm run build` → verify `dist/index.js` works
**Step 2:** `./dist/index.js validate tests/fixtures/full.yml` → passes
**Step 3:** Update `bin/dokku-compose` to be a thin Node wrapper or update `package.json` bin field
**Step 4:** Verify `npm run test` passes all tests

```bash
git commit -m "feat: build and distribution setup"
```

---

## Task 24: Integration Tests

**Files:**
- Create: `tests/integration.test.ts`

End-to-end with mock context:
1. `full.yml` → `up` → verify all expected dokku commands called
2. `full.yml` → `down --force` → verify destroy commands
3. Mock server state → `export` → verify output YAML
4. Mock divergent state → `diff` → verify summary output
5. `full.yml` → `validate` → no errors

```bash
git commit -m "test: add integration tests"
```

---

## Task 25: Cleanup + Documentation

- Update `README.md` (new commands, TS setup, npm install)
- Update `CLAUDE.md` (new project structure, test commands)
- Decide: keep or archive old `lib/*.sh`, `tests/*.bats`

```bash
git commit -m "docs: update README and CLAUDE.md for TypeScript rewrite"
```

---

## Execution Notes

- **Tasks 1-5** (scaffold + core): sequential, each builds on previous
- **Tasks 6-15** (modules): mostly independent, can parallelize
- **Tasks 16-21** (commands): depend on modules
- **Task 22** (CLI): depends on all commands
- **Tasks 23-25** (build/test/docs): final

Total: 25 tasks.
