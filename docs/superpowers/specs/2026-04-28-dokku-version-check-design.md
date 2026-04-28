# Dokku version check

## Summary

Wire up a runtime check for the existing `dokku.version` field in
`dokku-compose.yml`. When the user has pinned a version, compare it to the
server's reported version on `up` and `diff`. If the server is older than the
pinned floor, emit a warning. If the server's version cannot be parsed, raise
an error. Absent field is silent — today's behavior is preserved by default.

## Motivation

`dokku.version` is already in the schema (`src/core/schema.ts:99-101`) and is
written by `export` (`src/commands/export.ts:18-20`), but nothing reads it on
apply. Users round-tripping `export` → edit → `up` get a snapshot of the
server's version embedded in their config with no feedback if they later run
against an older or newer server. A minimum-version check turns that snapshot
into a meaningful floor without forcing exact-version churn on every patch
release.

## Behavior

### Semantics

- The pinned `dokku.version` value is interpreted as **minimum required**.
  Server version ≥ pinned is silent. Server version < pinned emits a warning.
- Comparison is numeric `MAJOR.MINOR.PATCH`. Pre-release suffixes
  (`-rc1`, `-beta`) on the server output are tolerated and ignored for the
  comparison.
- Field absent → silent (no warning, no error). The check is opt-in.

### Where the check runs

- `up` — runs once at the start of orchestration, before plugins. Warning
  is non-blocking; orchestration proceeds.
- `diff` — surfaces version drift in the summary output when pinned and
  mismatched.
- `validate` — **does not** run the check. `validate` is offline today and
  must stay offline; adding a server query would change its contract.
- `export` — unchanged. Continues to write the server's reported version
  into the emitted config.

### Error vs. warning

| Condition                          | Outcome  |
|------------------------------------|----------|
| Field absent                       | Silent   |
| Server version ≥ pinned            | Silent   |
| Server version < pinned            | Warning  |
| `dokku version` output unparseable | Error    |

Warning text:

```
Dokku server is v0.36.4 but dokku-compose.yml pins >= v0.37.9. Some features may be unavailable.
```

Rationale for unparseable → error: a `dokku version` command that returns
something we can't recognise as semver indicates the runner is talking to
something that isn't Dokku, or Dokku has changed its output format. Either
way, silently continuing risks misleading downstream behavior.

## Architecture

### New module: `src/modules/version.ts`

Exports two functions, one pure and one runner-aware:

```ts
// Pure helper — easy to unit-test without mocks.
// Returns -1 if a < b, 0 if equal, 1 if a > b.
// Throws if either input is not parseable as MAJOR.MINOR.PATCH.
export function compareSemver(a: string, b: string): -1 | 0 | 1

// Runner-aware orchestration entry point.
// No-op if `pinned` is undefined.
// Queries `dokku version`, parses, compares, logs.
// Throws on unparseable server output.
export async function ensureDokkuVersion(
  runner: DokkuRunner,
  pinned: string | undefined,
): Promise<void>
```

Parsing regex: `/(\d+)\.(\d+)\.(\d+)/`. This is intentionally identical to
the regex already used in `src/commands/export.ts:19` so the two sites stay
in lockstep — if one ever needs to handle a new format, both do.

### Wire-up

- `src/commands/up.ts` — call `ensureDokkuVersion(ctx, config.dokku?.version)`
  at the top of orchestration, before plugin installation. Warnings emit via
  `logWarn('dokku', ...)` from `src/core/logger.ts`.
- `src/commands/diff.ts` — include a "Dokku version" entry in the summary
  output when `config.dokku?.version` is set and the server version is
  lower. Quiet when matching or higher.

### No schema change

`ConfigSchema.dokku.version` already exists as `z.string().optional()`. No
migration, no version bump of the config format.

## Testing

### `src/modules/version.test.ts`

`compareSemver` — table-driven:

| `a`         | `b`         | expected |
|-------------|-------------|----------|
| `0.37.9`    | `0.37.9`    | `0`      |
| `0.37.9`    | `0.37.10`   | `-1`     |
| `0.38.0`    | `0.37.99`   | `1`      |
| `1.0.0`     | `0.99.99`   | `1`      |
| `0.37.9-rc1`| `0.37.9`    | `0`      | (pre-release suffix ignored)
| `garbage`   | `0.37.9`    | throws   |

`ensureDokkuVersion` — with mocked `runner.query`:

- Returns silently when `pinned` is `undefined` (no query made).
- Returns silently when server ≥ pinned.
- Logs a warning when server < pinned. Asserts the message includes both
  versions.
- Throws when server output does not contain `X.Y.Z`.

### Integration

No new fixture YAML required — `dokku.version` already round-trips through
the existing schema.

## Out of scope

- `max_version` / range constraints. Add when there is a known-breaking
  upper bound to enforce. Until then, YAGNI.
- Semver constraint strings (`^`, `>=`, etc.). The minimum-version
  semantic covers the realistic use case without a parser dependency.
- Pinning Dokku plugin versions against the server. Plugins already accept
  a `version` field per plugin entry; that's a separate concern.
- A `--strict` flag to escalate the warning to an error. Easy to add later
  if needed; not required for the initial behavior.
