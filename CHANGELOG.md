# Changelog

## [Unreleased]

## [0.6.10] - 2026-03-05

### Added

- `diff` command now masks sensitive values (TOKEN, SECRET, PASSWORD, KEY, AUTH, CREDENTIAL) by default
- `--sensitive` flag on `diff` to reveal full values
- `maskSensitiveData` for deep-masking values in data structures (env vars, build args)

## [0.6.9] - 2026-03-05

### Changed

- Restored bulk `readAll` for Builder, DockerOptions, and `plugin:list` — these work correctly via SSH mode (`DOKKU_HOST`), which is the recommended way to run on the server

## [0.6.8] - 2026-03-05

### Fixed

- Plugin detection now uses `plugin:installed` per-plugin check instead of `plugin:list` bulk query, which fails from Node subprocess due to Dokku basher issues

## [0.6.7] - 2026-03-05

### Fixed

- Builder and DockerOptions resources no longer use bulk `readAll` — these Dokku plugins don't support bulk mode (no app arg) from Node subprocesses due to basher environment issues
- Removed debug logging from `dokku.ts` and `context.ts`

## [0.6.3] - 2026-03-05

### Added

- `DOKKU_COMPOSE_DEBUG=1` env var to trace builder readAll parsing

## [0.6.2] - 2026-03-04

### Fixed

- `parseBulkReport` now handles multi-word namespaces (e.g. `docker options`) in report headers
- Certs bulk report uses correct `ssl` namespace matching real Dokku output

## [0.6.1] - 2026-03-04

### Added

- DockerOptions resource now reads from `docker-options:report`, removing `forceApply`
- `docker_options` now appear in `export` and `diff` output

### Fixed

- DockerOptions `onChange` uses targeted add/remove instead of clearing all options, preventing loss of `--link` and `--build-arg` entries managed by other resources

## [0.6.0] - 2026-03-04

### Added

- Build properties (`dockerfile`, `app_json`, `context`, `args`) now appear in `export` and `diff` output
- Builder resource reads current state from Dokku reports instead of blindly reapplying

### Fixed

- Plugin detection now uses realistic `plugin:list` output parsing with bulk query (single SSH call)
- `parseReport` now handles hyphenated namespaces (`builder-dockerfile`, `app-json`, `docker-options`)

## [0.5.2] - 2026-03-04

### Fixed

- Sensitive value masking now handles values containing `=` (e.g. base64 tokens)

## [0.5.1] - 2026-03-04

### Changed

- `--dry-run` now queries real server state, only showing commands that would actually change something
- Sensitive env var values (TOKEN, SECRET, PASSWORD, KEY, AUTH, CREDENTIAL) are masked in dry-run output by default, showing last 4 chars
- Added `--sensitive` flag to reveal full values in dry-run output

## [0.5.0] - 2026-03-04

### Added

- Bulk prefetch via `readAll` on resources for ~10x fewer SSH calls in `export` and `diff`
- `parseBulkReport` for multi-app Dokku report parsing
- `readAll` support for property, list, toggle, certs, networks, and git resources

## [0.4.0] - 2026-03-04

### Added

- Resource reconciler with generic `Resource` interface and `reconcile` loop
- `computeChange` with scalar, list, and map diffing
- `Context` with cached queries and command recording
- Resource definitions for all modules: property, list, toggle, lifecycle, config, certs, docker-options, builder, git, checks, and network
- Git module (`git:initialize` + `deploy-branch`)
- Service backup configuration (`backup-auth` + `backup-schedule`)
- `${VAR}` environment variable interpolation in config loader
- `--image` and `--image-version` flags on service create

### Changed

- Rewrote `export` and `diff` commands using resource registry
- Wired resource registry into `up` command
- Unified on `Context` everywhere, removed `Runner` passthrough
- Removed old module files replaced by resource definitions

### Fixed

- Idempotent `nginx:set` with `proxy:build-config` on change
- Logging consistency in nginx and git modules
- Pass `--image` and `--image-version` flags on service create
