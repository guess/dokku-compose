# Changelog

## [Unreleased]

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
