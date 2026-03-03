# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

dokku-compose is a Bash-based declarative orchestrator for Dokku servers. Users define infrastructure in a single YAML file (`dokku-compose.yml`) and the tool idempotently configures Dokku apps, services, networks, and plugins. Think Docker Compose but for Dokku.

**Requirements:** bash >= 4.0, yq >= 4.0

## Commands

```bash
# Run all tests
./tests/bats/bin/bats tests/

# Run a single test file
./tests/bats/bin/bats tests/services.bats

# Run the tool (local or via DOKKU_HOST for remote)
./bin/dokku-compose up --dry-run
```

There is no build step, linter, or compilation — it's all bash scripts.

```bash
# Cut a release (checks CI passed first)
scripts/release.sh 0.2.0
```

## Architecture

**Entry point:** `bin/dokku-compose` — CLI parser and command dispatcher.

**Library modules** (`lib/`): Each file maps to one Dokku command namespace and exports `ensure_*()` / `destroy_*()` functions:

- `core.sh` — Logging (colored), `dokku_cmd()` wrapper, helper functions (`dokku_set_properties`, `dokku_set_list`, `dokku_set_property`)
- `yaml.sh` — YAML parsing helpers wrapping `yq`
- `apps.sh` — App creation/destruction
- `domains.sh` — Domain configuration, vhost enable/disable
- `services.sh` — Generic handler for all service plugins (postgres, redis, mongo, etc.)
- `plugins.sh` — Plugin installation
- `network.sh` — Shared Docker networks
- `proxy.sh` — Proxy enable/disable
- `ports.sh` — Port mappings
- `certs.sh` — SSL certificates
- `storage.sh` — Persistent storage mounts
- `nginx.sh` — Nginx properties
- `checks.sh` — Zero-downtime deploy checks
- `logs.sh` — Log management
- `registry.sh` — Registry management
- `scheduler.sh` — Scheduler selection
- `config.sh` — Environment variables
- `builder.sh` — Dockerfile builder, app.json path
- `docker_options.sh` — Per-phase Docker options
- `dokku.sh` — Dokku version check, installation

**Execution flow for `up`:** Version check → Plugins → Networks → Services → Per-app configuration (create app → domains → services → networks → proxy → ports → certs → storage → nginx → checks → logs → registry → scheduler → env vars → builder → docker options).

**Idempotency pattern:** Every `ensure_*` function queries current Dokku state via `dokku_cmd_check()` before acting. If state already matches, it logs "already configured" and skips. `dokku_cmd_check()` is for read-only queries (not logged in tests); `dokku_cmd()` is for mutations (logged and asserted in tests).

## Testing

Tests use BATS (Bash Automated Testing System), installed as git submodules under `tests/bats/` and `tests/test_helper/`.

**Test conventions:**
- Each `lib/*.sh` module has a corresponding `tests/*.bats` file
- Tests mock `dokku_cmd` and `dokku_cmd_check` via `setup_mocks` in `tests/test_helper.bash`
- Key mock helpers: `mock_dokku_exit`, `mock_dokku_output`, `assert_dokku_called`, `refute_dokku_called`, `assert_dokku_call_count`
- Test fixtures live in `tests/fixtures/*.yml`
- `tests/integration.bats` covers end-to-end up/down workflows

## Documentation

- `docs/reference/` contains per-module user-facing reference docs (see `docs/reference/CLAUDE.md` for the template)
- When adding or updating a feature in the README, keep the README section brief and link to the corresponding `docs/reference/*.md` file for full details (e.g., `([full reference](docs/reference/apps.md))`)

## Code Conventions

- All scripts use `set -euo pipefail`
- 4-space indentation
- Module functions follow `ensure_<feature>(app)` / `destroy_<feature>(app)` naming
- Service naming convention: `{app}-{plugin}` (e.g., "api-postgres")
- YAML access uses `yaml_get`, `yaml_app_get`, `yaml_app_list`, `yaml_app_has`, `yaml_app_map_keys`, `yaml_app_map_get` helpers
- Global state: `DOKKU_COMPOSE_DRY_RUN`, `DOKKU_COMPOSE_ERRORS`, `DOKKU_COMPOSE_FAIL_FAST`
- Remote execution via `DOKKU_HOST` env var (SSH transport)
