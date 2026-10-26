# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

dokku-compose is a declarative orchestrator for Dokku servers. Users define infrastructure in a single YAML file (`dokku-compose.yml`) and the tool idempotently configures Dokku apps, services, networks, and plugins. Think Docker Compose but for Dokku.

**Requirements:** Node.js >= 20 (end users), Bun >= 1.0 (development)

## Commands

```bash
# Run all tests
bun test

# Run a single test file
bun test src/resources/ps.test.ts

# Run the tool from source (local, or via DOKKU_HOST for remote)
bun run dev up --dry-run

# Build the CLI (tsup -> dist/)
bun run build
```

## Architecture

**Entry point:** `bin/dokku-compose` is a two-line Node shim that imports `dist/index.js`, so run `bun run build` before using it. In development use `bun run dev` (`bun src/index.ts`).

**Source:** `src/` — TypeScript project with Commander.js CLI (`src/index.ts`).

**Core** (`src/core/`):
- `schema.ts` — Zod schema (single source of truth for types + validation)
- `config.ts` — YAML loader (js-yaml + Zod parse)
- `dokku.ts` — Dokku command runner (`run`, `query`, `queryStrict`, `check`); SSH via `DOKKU_HOST`; dry-run support
- `context.ts` — `Context` wraps the runner: caches `query`, records every mutation, collects the restart/rebuild summary `up` prints (`needsRestart`, `needsRebuild`)
- `reconcile.ts` — the `Resource` interface and `reconcile()`: read current state, diff against the file, apply, and with `--prune` reset what the file dropped
- `change.ts` — list/map diffs used by `reconcile`
- `config-json.ts`, `mask.ts`, `shellwords.ts` — `config:export` JSON parsing, secret masking, shell-style splitting
- `logger.ts` — Colored output (chalk)

**Resources** (`src/resources/`): per-app features as `Resource` objects (`key`, `read`, `onChange`, optional `readAll`, `removals`, `prune`), shared by `up`, `diff` and `export`. `index.ts` lists them in phases. Resources are built from the generic helpers in `lists.ts`, `properties.ts`, `toggle.ts` and `parsers.ts`:

- `lifecycle.ts` — App create/destroy
- `lists.ts` — Domains, ports
- `storage.ts` — An app's named storage mounts, converged per process type with `storage:mount --replace` (a mount is one `[scope=]entry:dir[:tokens]` string)
- `properties.ts` — Nginx, logs, registry and scheduler properties (`<ns>:set`), with the settable key lists
- `toggle.ts` — Proxy enable/disable and proxy properties
- `network.ts` — App networks (attach) and network properties
- `certs.ts` — SSL certificates
- `checks.ts` — Zero-downtime deploy checks
- `ps.ts` — Process scale (`ps:scale --skip-deploy`) and ps properties (`ps:set`); additive resources
- `config.ts` — App environment variables (managed via `DOKKU_COMPOSE_MANAGED_KEYS`)
- `builder.ts` — Builder selection and properties, build args
- `git.ts` — Git properties
- `docker-options.ts` — Per-phase Docker options

**Modules** (`src/modules/`): host-level and service features that are not per-app resources, with `ensure*()`, `destroy*()`, `export*()` and read helpers as each needs:

- `apps.ts` — App listing for `export` (`exportApps`) and app destroy for `down`
- `domains.ts`, `logs.ts`, `nginx.ts`, `config.ts` — Global domains, logs, nginx properties and env
- `docker-auth.ts` — Host registry logins
- `postgres.ts`, `redis.ts` — Service creation, Postgres backups, export
- `service-drift.ts` — Service version and backup drift for `diff`
- `links.ts` — Cross-plugin service link resolution and convergence
- `network.ts` — Shared Docker networks
- `volumes.ts` — Top-level `volumes:` storage entries (`storage:create`, `storage:set`), their `diff` state, and the `export` naming of `legacy-*` entries
- `plugins.ts` — Plugin installation, version pins (forward-only updates), plugin:list parser
- `env-notes.ts` — Notes for app env keys the file does not declare
- `version.ts` — Dokku version floor and file version check

**Commands** (`src/commands/`):
- `up.ts` — Orchestrate the global phases, services and per-app resources in dependency order
- `down.ts` — Tear down in reverse order
- `ps.ts` — Show app status
- `init.ts` — Write starter YAML
- `validate.ts` — Offline schema + cross-field validation
- `export.ts` — Query server state → emit YAML
- `diff.ts` — Compare local YAML vs server state (summary + verbose modes)

**Execution flow for `up`:** Version check → Plugins and Docker auth → Global config (domains, env, logs, nginx) → Networks → Volumes → Postgres → Redis → Postgres backups → Per-app (create → domains → networks → network properties → proxy → proxy properties → ports → links → certs → storage (skipped when an entry it mounts failed in Volumes) → nginx → checks → logs → registry → scheduler → ps → scale → env vars → builder → git → docker options). Each per-app resource runs in its own step: a resource that throws is logged and the app's remaining resources still run; the run ends with `UpFailedError` listing every failing app (`--fail-fast` stops at the first failure instead). With `--prune`, the nginx, logs, registry, scheduler, ps, network, proxy-property, checks, build and git resources also reset the settings the file no longer declares (`Resource.prune`, run after the normal apply; a block absent from the file is read once to find them).

**Version check:** every server command (`up`, `diff`, `down`, `export`, `ps`) calls `assertDokkuSupported` (`src/modules/version.ts`) first: below `MIN_DOKKU_VERSION` (0.38.29, the first Dokku with `registry:auth-status`) it throws before any other Dokku call. `dokku.version` in the file is a hard minimum for `up` (`enforceFileVersion`); `diff` reports any difference as a drift line and a newer server only makes `up` log a notice.

**Idempotency pattern:** Every resource and `ensure*` function reads current Dokku state before acting. If state already matches, it logs a skip and does nothing. Use `ctx.check()` for boolean state queries, `ctx.query()` for cached reads (`ctx.queryStrict()` when a failure must not look like empty output), and `ctx.run()` for mutations.

**Env var convergence:** `DOKKU_COMPOSE_MANAGED_KEYS` is stored as an app env var tracking which keys dokku-compose owns. On each run: read the marker and the managed keys' current values (`config:export --format json` is read strictly, so a failure is an error, never an empty env), unset keys no longer in `env:`, then set the desired keys and rewrite the marker. A missing `env:` block counts as `{}`: every managed key is unset and the marker is unset (never written empty). If `config:unset` fails, the error is surfaced and the marker still names the keys, so the next run retries. Keys outside the marker (`DATABASE_URL`, etc.) are never touched.

## Testing

Tests use Vitest.

```bash
bun test          # run all tests
bun test --watch  # watch mode
```

**Test conventions:**
- Each `src/modules/*.ts` and `src/resources/*.ts` has a corresponding `*.test.ts` beside it
- Tests build a runner with `createRunner({ dryRun: false })`, replace `runner.query`, `runner.queryStrict`, `runner.check`, `runner.run` with `vi.fn()` and wrap it in `createContext(runner)`; `src/tests/fake-server.ts` is a fake Dokku that answers reads from tables and records mutations
- Compose-file fixtures live in `src/tests/fixtures/*.yml`; real Dokku 0.38.31 `<ns>:report` output lives in `src/tests/fixtures/dokku-0.38.31/reports`
- `src/tests/` also holds the cross-cutting checks: `in-sync.test.ts` (when `diff` says in sync, `up` changes nothing), `property-keys.test.ts` (settable keys against the 0.38.31 reports) and `audit.test.ts` (the audit doc)
- TDD: write failing test → implement → verify passing

## Documentation

- `docs/dokku-audit.md` is the tracker: its Priorities table holds the planned work (`F*` and `A*` items) with a status mark (✅ 🟡 ❌ ⛔) and PR links. An item ships in one PR: the first commit is the design, an in-place edit of `docs/reference/<module>.md` describing what the PR ships (never a "Proposed" or plan section; reference docs always describe the latest behaviour), later commits implement it, and the last updates the row, the `scripts/dokku-audit/*.tsv` statuses and the generated tables (see the doc's "Tracking work" section). Implementation plans stay out of the repo; `src/tests/audit.test.ts` fails when they trail the code. Commits, PRs and the changelog name the item and the PR, never a Linear ticket
- `docs/reference/` contains per-module user-facing reference docs (see `docs/reference/CLAUDE.md` for the template)
- When adding or updating a feature in the README, keep the README section brief and link to the corresponding `docs/reference/*.md` file at the end of the section

## Code Conventions

- TypeScript strict mode
- 2-space indentation (TypeScript files)
- Module functions: `ensurePostgres(ctx, ...)` / `destroyPostgres(ctx, ...)` / `exportPostgres(ctx)`; per-app features are `Resource` objects reconciled with `reconcile(resource, ctx, app, desired)`
- Service naming convention: `{app}-{plugin}` (e.g., `api-postgres`)
- Remote execution via `DOKKU_HOST` env var (SSH transport)
- Module `ensure*` functions take a `Context` and are async
