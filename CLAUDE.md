# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

dokku-compose is a declarative orchestrator for Dokku servers. Users define infrastructure in a single YAML file (`dokku-compose.yml`) and the tool idempotently configures Dokku apps, services, networks, and plugins. Think Docker Compose but for Dokku.

**Requirements:** Node.js >= 18, npm

## Commands

```bash
# Run all tests
npm test

# Run a single test file
npx vitest run src/modules/apps.test.ts

# Run the tool (local or via DOKKU_HOST for remote)
./bin/dokku-compose up --dry-run

# Build the CLI
npm run build
```

## Architecture

**Entry point:** `bin/dokku-compose` — thin bash shim that delegates to `src/index.ts` via `tsx`.

**Source:** `src/` — TypeScript project with Commander.js CLI.

**Core modules** (`src/core/`):
- `schema.ts` — Zod schema (single source of truth for types + validation)
- `config.ts` — YAML loader (js-yaml + Zod parse)
- `dokku.ts` — Dokku command runner (`run`, `query`, `check`); SSH via `DOKKU_HOST`; dry-run support
- `logger.ts` — Colored output (chalk)

**Feature modules** (`src/modules/`): One file per Dokku namespace, each exports `ensure*()`, `destroy*()`, and `export*()` functions:

- `apps.ts` — App creation/destruction
- `domains.ts` — Domain configuration, vhost enable/disable
- `services.ts` — Service plugins (postgres, redis, etc.) with link convergence
- `plugins.ts` — Plugin installation
- `network.ts` — Shared Docker networks
- `proxy.ts` — Proxy enable/disable
- `ports.ts` — Port mappings (order-insensitive comparison)
- `certs.ts` — SSL certificates
- `storage.ts` — Persistent storage mounts (convergence)
- `nginx.ts` — Nginx properties
- `checks.ts` — Zero-downtime deploy checks
- `logs.ts` — Log management
- `registry.ts` — Registry management
- `scheduler.ts` — Scheduler selection
- `config.ts` — Environment variables (managed via `DOKKU_COMPOSE_MANAGED_KEYS`)
- `builder.ts` — Dockerfile builder, app.json path, build args
- `docker-options.ts` — Per-phase Docker options

**Commands** (`src/commands/`):
- `up.ts` — Orchestrate all `ensure*` calls in dependency order
- `down.ts` — Tear down in reverse order
- `ps.ts` — Show app status
- `init.ts` — Write starter YAML
- `validate.ts` — Offline schema + cross-field validation
- `export.ts` — Query server state → emit YAML
- `diff.ts` — Compare local YAML vs server state (summary + verbose modes)

**Execution flow for `up`:** Plugins → Global config → Networks → Services → Per-app (create → domains → links → networks → proxy → ports → certs → storage → nginx → checks → logs → registry → scheduler → env vars → builder → docker options).

**Idempotency pattern:** Every `ensure*` function queries current Dokku state before acting. If state already matches, it logs "already configured" and skips. `runner.check()` is for boolean state queries; `runner.query()` for output-capturing queries; `runner.run()` for mutations.

**Env var convergence:** `DOKKU_COMPOSE_MANAGED_KEYS` is stored as an app env var tracking which keys dokku-compose owns. On each run: read previous managed set, unset orphaned keys (prev - desired), set desired keys, update managed set. Dokku-injected vars (`DATABASE_URL`, etc.) are never in the managed set.

## Testing

Tests use Vitest.

```bash
npm test          # run all tests
npm run test:watch  # watch mode
```

**Test conventions:**
- Each `src/modules/*.ts` has a corresponding `*.test.ts`
- Tests mock `runner.check`, `runner.run`, `runner.query` with `vi.fn()`
- Test fixtures live in `src/tests/fixtures/*.yml`
- TDD: write failing test → implement → verify passing

## Documentation

- `docs/reference/` contains per-module user-facing reference docs (see `docs/reference/CLAUDE.md` for the template)
- When adding or updating a feature in the README, keep the README section brief and link to the corresponding `docs/reference/*.md` file at the end of the section

## Code Conventions

- TypeScript strict mode
- 2-space indentation (TypeScript files)
- Module functions: `ensureApp(runner, app)` / `destroyApp(runner, app)` / `exportApps(runner)`
- Service naming convention: `{app}-{plugin}` (e.g., `api-postgres`)
- Remote execution via `DOKKU_HOST` env var (SSH transport)
- All `ensure*` functions are async and return `Promise<void>`
