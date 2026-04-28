# Dokku Version Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up a runtime check for the existing `dokku.version` field so that `up` and `diff` warn when the server's Dokku version is older than what the user pinned.

**Architecture:** A new module `src/modules/version.ts` exposes a pure semver comparator (`compareSemver`) and a runner-aware orchestration function (`ensureDokkuVersion`). The orchestration function is called once at the start of both `runUp` and `computeDiff`. Server output is parsed with the same regex `export.ts` already uses. Behavior is opt-in: silent when `dokku.version` is absent.

**Tech Stack:** TypeScript (strict), Vitest (mocking via `vi.fn()`), the existing `Context` and chalk-based logger.

**Spec:** `docs/superpowers/specs/2026-04-28-dokku-version-check-design.md`

> **Note on spec:** the spec sketches the function signature as `(runner: DokkuRunner, ...)` informally. The actual codebase passes `Context` to module functions (see `src/modules/plugins.ts` etc.). This plan uses `Context` — that is the correct type.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/modules/version.ts` | Create | `compareSemver` (pure) + `ensureDokkuVersion(ctx, pinned)` |
| `src/modules/version.test.ts` | Create | Unit tests for both exports |
| `src/commands/up.ts` | Modify | Call `ensureDokkuVersion` before plugins |
| `src/commands/diff.ts` | Modify | Call `ensureDokkuVersion` before prefetch |
| `docs/reference/dokku.md` | Create | User-facing reference for the `dokku.version` key |
| `README.md` | Modify | Add a row to the Features table linking to `dokku.md` |

---

## Prerequisites

- Run `bun install` from the repo root if you haven't already.
- This project uses **Vitest** as the test framework, but tests are invoked through Bun's built-in test runner via `bun test <path>`. No separate Vitest setup is needed — `bun test` discovers Vitest automatically.
- The `Context` type (passed to module functions) is defined at `src/core/context.ts:3`. The `Runner` type (used inside tests via `createRunner`) is at `src/core/dokku.ts:11`. Test files create a runner, override its methods with `vi.fn()`, then wrap with `createContext(runner)` — see `src/modules/plugins.test.ts` for the canonical pattern.

---

## Task 1: `compareSemver` pure helper

**Files:**
- Create: `src/modules/version.ts`
- Create: `src/modules/version.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/modules/version.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { compareSemver } from './version.js'

describe('compareSemver', () => {
  it('returns 0 for equal versions', () => {
    expect(compareSemver('0.37.9', '0.37.9')).toBe(0)
  })

  it('returns -1 when a is older (patch)', () => {
    expect(compareSemver('0.37.9', '0.37.10')).toBe(-1)
  })

  it('returns 1 when a is newer (minor)', () => {
    expect(compareSemver('0.38.0', '0.37.99')).toBe(1)
  })

  it('returns 1 when a is newer (major)', () => {
    expect(compareSemver('1.0.0', '0.99.99')).toBe(1)
  })

  it('ignores pre-release suffix when otherwise equal', () => {
    expect(compareSemver('0.37.9-rc1', '0.37.9')).toBe(0)
  })

  it('ignores pre-release suffix on both sides', () => {
    expect(compareSemver('0.37.9-rc1', '0.37.9-rc2')).toBe(0)
  })

  it('throws when input is not parseable', () => {
    expect(() => compareSemver('garbage', '0.37.9')).toThrow(/parse/i)
  })

  it('throws when only major.minor (missing patch)', () => {
    expect(() => compareSemver('0.37', '0.37.9')).toThrow(/parse/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/modules/version.test.ts`
Expected: FAIL — `Cannot find module './version.js'` (or similar import error).

- [ ] **Step 3: Implement `compareSemver`**

Create `src/modules/version.ts`:

```typescript
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)/

function parseSemver(input: string): [number, number, number] {
  const m = input.match(SEMVER_RE)
  if (!m) throw new Error(`Cannot parse version: ${input}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const [aMaj, aMin, aPatch] = parseSemver(a)
  const [bMaj, bMin, bPatch] = parseSemver(b)
  if (aMaj !== bMaj) return aMaj < bMaj ? -1 : 1
  if (aMin !== bMin) return aMin < bMin ? -1 : 1
  if (aPatch !== bPatch) return aPatch < bPatch ? -1 : 1
  return 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/modules/version.test.ts`
Expected: PASS — 8 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/modules/version.ts src/modules/version.test.ts
git commit -m "feat: add compareSemver helper"
```

---

## Task 2: `ensureDokkuVersion` orchestration function

**Files:**
- Modify: `src/modules/version.ts`
- Modify: `src/modules/version.test.ts`

- [ ] **Step 1: Replace `src/modules/version.test.ts` with the complete final test file**

This step replaces the file from Task 1 with the full final version (existing tests + new tests). Imports stay grouped at the top of the file as is the project convention. Note that `warnSpy.mock.calls[0][0]` will contain ANSI color codes (chalk wraps the string in yellow); `toContain('0.36.4')` still works because the digits appear verbatim in the formatted output.

Replace the contents of `src/modules/version.test.ts` with:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { compareSemver, ensureDokkuVersion } from './version.js'

describe('compareSemver', () => {
  it('returns 0 for equal versions', () => {
    expect(compareSemver('0.37.9', '0.37.9')).toBe(0)
  })

  it('returns -1 when a is older (patch)', () => {
    expect(compareSemver('0.37.9', '0.37.10')).toBe(-1)
  })

  it('returns 1 when a is newer (minor)', () => {
    expect(compareSemver('0.38.0', '0.37.99')).toBe(1)
  })

  it('returns 1 when a is newer (major)', () => {
    expect(compareSemver('1.0.0', '0.99.99')).toBe(1)
  })

  it('ignores pre-release suffix when otherwise equal', () => {
    expect(compareSemver('0.37.9-rc1', '0.37.9')).toBe(0)
  })

  it('ignores pre-release suffix on both sides', () => {
    expect(compareSemver('0.37.9-rc1', '0.37.9-rc2')).toBe(0)
  })

  it('throws when input is not parseable', () => {
    expect(() => compareSemver('garbage', '0.37.9')).toThrow(/parse/i)
  })

  it('throws when only major.minor (missing patch)', () => {
    expect(() => compareSemver('0.37', '0.37.9')).toThrow(/parse/i)
  })
})

describe('ensureDokkuVersion', () => {
  it('does nothing when pinned is undefined (no query)', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn()
    const ctx = createContext(runner)
    await ensureDokkuVersion(ctx, undefined)
    expect(runner.query).not.toHaveBeenCalled()
  })

  it('is silent when server version equals pinned', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('dokku version 0.37.9')
    const ctx = createContext(runner)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await ensureDokkuVersion(ctx, '0.37.9')
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('is silent when server version is newer than pinned', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('0.38.0')
    const ctx = createContext(runner)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await ensureDokkuVersion(ctx, '0.37.9')
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('warns when server version is older than pinned', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('dokku version 0.36.4')
    const ctx = createContext(runner)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await ensureDokkuVersion(ctx, '0.37.9')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const msg = warnSpy.mock.calls[0][0] as string
    expect(msg).toContain('0.36.4')
    expect(msg).toContain('0.37.9')
    warnSpy.mockRestore()
  })

  it('throws when server output is unparseable', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('something weird')
    const ctx = createContext(runner)
    await expect(ensureDokkuVersion(ctx, '0.37.9')).rejects.toThrow(/parse/i)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/modules/version.test.ts`
Expected: FAIL — `ensureDokkuVersion is not exported from './version.js'`.

- [ ] **Step 3: Replace `src/modules/version.ts` with the complete final module file**

Imports go at the top (project convention). Replace the contents of `src/modules/version.ts` with:

```typescript
import type { Context } from '../core/context.js'
import { logWarn } from '../core/logger.js'

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)/

function parseSemver(input: string): [number, number, number] {
  const m = input.match(SEMVER_RE)
  if (!m) throw new Error(`Cannot parse version: ${input}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const [aMaj, aMin, aPatch] = parseSemver(a)
  const [bMaj, bMin, bPatch] = parseSemver(b)
  if (aMaj !== bMaj) return aMaj < bMaj ? -1 : 1
  if (aMin !== bMin) return aMin < bMin ? -1 : 1
  if (aPatch !== bPatch) return aPatch < bPatch ? -1 : 1
  return 0
}

export async function ensureDokkuVersion(
  ctx: Context,
  pinned: string | undefined
): Promise<void> {
  if (!pinned) return

  const output = await ctx.query('version')
  const match = output.match(/(\d+\.\d+\.\d+)/)
  if (!match) {
    throw new Error(`Cannot parse Dokku server version from output: ${output}`)
  }
  const server = match[1]

  if (compareSemver(server, pinned) === -1) {
    logWarn(
      'dokku',
      `server is v${server} but dokku-compose.yml pins >= v${pinned}. Some features may be unavailable.`
    )
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/modules/version.test.ts`
Expected: PASS — all tests in the file passing (5 new + 8 from Task 1 = 13).

- [ ] **Step 5: Commit**

```bash
git add src/modules/version.ts src/modules/version.test.ts
git commit -m "feat: add ensureDokkuVersion check"
```

---

## Task 3: Wire into `up`

**Files:**
- Modify: `src/commands/up.ts:35-36` (insert before "Phase 1: Plugins")

- [ ] **Step 1a: Add the import**

In `src/commands/up.ts`, add this line to the module-imports block (the `import { ensure* } from '../modules/*.js'` cluster around lines 15-24). Alphabetical order suggests placing it between `ensureRedis` and `ensureAppLinks` is fine — exact placement isn't enforced:

```typescript
import { ensureDokkuVersion } from '../modules/version.js'
```

- [ ] **Step 1b: Insert the version-check call before Phase 1**

The current `runUp` body has this structure (verified against `src/commands/up.ts:31-37`):

```typescript
  const apps = appFilter.length > 0
    ? appFilter
    : Object.keys(config.apps)

  // Phase 1: Plugins & host-level auth
  if (config.plugins) await ensurePlugins(ctx, config.plugins)
  if (config.docker_auth) await ensureDockerAuth(ctx, config.docker_auth)
```

**Insert two new lines (a comment and the call) immediately before the `// Phase 1:` comment line. Do NOT modify or remove any existing lines.** The result should look like:

```typescript
  const apps = appFilter.length > 0
    ? appFilter
    : Object.keys(config.apps)

  // Phase 0: Version check (warning-only, opt-in via dokku.version)
  await ensureDokkuVersion(ctx, config.dokku?.version)

  // Phase 1: Plugins & host-level auth
  if (config.plugins) await ensurePlugins(ctx, config.plugins)
  if (config.docker_auth) await ensureDockerAuth(ctx, config.docker_auth)
```

- [ ] **Step 2: Run the full test suite**

Run: `bun test`
Expected: PASS — all existing tests still passing, no regressions.

- [ ] **Step 3: Build to confirm TypeScript compiles**

Run: `bun run build`
Expected: PASS — no TypeScript errors.

(End-to-end smoke testing requires a `DOKKU_HOST`. The unit tests in Task 2 fully cover the runtime logic, and the build verifies the wiring compiles. If you have a server available, you can additionally run `DOKKU_HOST=<host> ./bin/dokku-compose up -f src/tests/fixtures/simple.yml --dry-run` — the fixture does not pin `dokku.version`, so no warning should appear.)

- [ ] **Step 4: Commit**

```bash
git add src/commands/up.ts
git commit -m "feat: check dokku version on up"
```

---

## Task 4: Wire into `diff`

**Files:**
- Modify: `src/commands/diff.ts:26-30` (insert before bulk prefetch)

- [ ] **Step 1: Add the import and call**

Edit `src/commands/diff.ts`. Add this import next to the existing imports (around line 4):

```typescript
import { ensureDokkuVersion } from '../modules/version.js'
```

Then insert the version check at the top of `computeDiff`, before the bulk prefetch. The existing block:

```typescript
export async function computeDiff(ctx: Context, config: Config): Promise<DiffResult> {
  const result: DiffResult = { apps: {}, services: {}, inSync: true }

  // Bulk prefetch: run all readAll queries in parallel
```

becomes:

```typescript
export async function computeDiff(ctx: Context, config: Config): Promise<DiffResult> {
  const result: DiffResult = { apps: {}, services: {}, inSync: true }

  // Version check (warning-only, opt-in via dokku.version)
  await ensureDokkuVersion(ctx, config.dokku?.version)

  // Bulk prefetch: run all readAll queries in parallel
```

- [ ] **Step 2: Run the full test suite**

Run: `bun test`
Expected: PASS — no regressions.

- [ ] **Step 3: Commit**

```bash
git add src/commands/diff.ts
git commit -m "feat: check dokku version on diff"
```

---

## Task 5: Reference docs + README link

**Files:**
- Create: `docs/reference/dokku.md`
- Modify: `README.md:107-130` (Features table)

- [ ] **Step 1: Create the reference doc**

Create `docs/reference/dokku.md` with exactly this content (a four-backtick fence is used here so the inner three-backtick yaml fence is shown verbatim — the file itself uses normal three-backtick fences):

````markdown
# Dokku Version

Dokku docs: https://dokku.com/docs/getting-started/upgrading/

Module: `src/modules/version.ts`

## YAML Keys

### Pinned Version (`dokku.version`)

Declare the minimum Dokku server version your config requires. On `up` and
`diff`, dokku-compose queries the server with `dokku version` and warns if
the server is older than the pinned value. The check is opt-in — if the key
is absent, no check runs.

The value is interpreted as a **minimum**, not an exact match: a server
running a newer version than pinned is silent. Pre-release suffixes
(`-rc1`, `-beta`) on the server output are tolerated.

The `export` command writes the running server's version into this field
automatically, so round-tripping `export` → edit → `up` produces a useful
floor without manual effort.

```yaml
dokku:
  version: "0.37.9"          # warn if server is < 0.37.9
```

| Value | Behavior |
|-------|----------|
| `"X.Y.Z"` | `dokku version` (query)<br>warn if server version `< X.Y.Z` |
| absent | no action |

If the server's `dokku version` output cannot be parsed as `X.Y.Z`,
dokku-compose raises an error rather than continuing silently — that
indicates either the runner is talking to something that isn't Dokku, or
Dokku has changed its output format.
````

- [ ] **Step 2: Add the row to the README Features table**

In `README.md`, find the Features table (around lines 111-130). Insert one new row immediately after the `| Apps | ... |` row and before the `| Environment Variables | ... |` row. The new row is:

```markdown
| Dokku Version | Warn when the server's Dokku version is older than the pinned floor | [dokku](docs/reference/dokku.md) |
```

After the edit, the top of the table should read exactly:

```markdown
| Feature | Description | Reference |
|---------|-------------|-----------|
| Apps | Create and destroy Dokku apps | [apps](docs/reference/apps.md) |
| Dokku Version | Warn when the server's Dokku version is older than the pinned floor | [dokku](docs/reference/dokku.md) |
| Environment Variables | Set config vars per app or globally, with full convergence | [config](docs/reference/config.md) |
```

- [ ] **Step 3: Verify links resolve**

Run: `ls docs/reference/dokku.md && grep -F "docs/reference/dokku.md" README.md`
Expected: file listed, README contains the link.

- [ ] **Step 4: Commit**

```bash
git add docs/reference/dokku.md README.md
git commit -m "docs: document dokku.version field"
```

---

## Final Verification

- [ ] **Step 1: Full test suite**

Run: `bun test`
Expected: PASS — all tests including the 13 new ones in `version.test.ts`.

- [ ] **Step 2: Build**

Run: `bun run build`
Expected: PASS — TypeScript strict mode compiles clean.

- [ ] **Step 3: Smoke test (offline)**

`validate` takes a positional file argument (see `src/index.ts:73-75`).

Run: `./bin/dokku-compose validate src/tests/fixtures/simple.yml`
Expected: no errors and no warning about Dokku version. `validate` runs offline and never queries the server, so the version check must not fire here — that confirms the wiring (Tasks 3 and 4) is in `up`/`diff` only.
