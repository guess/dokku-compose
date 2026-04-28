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

- [ ] **Step 1: Add failing tests for `ensureDokkuVersion`**

Append to `src/modules/version.test.ts`:

```typescript
import { vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { ensureDokkuVersion } from './version.js'

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

- [ ] **Step 3: Implement `ensureDokkuVersion`**

Append to `src/modules/version.ts`:

```typescript
import type { Context } from '../core/context.js'
import { logWarn } from '../core/logger.js'

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

- [ ] **Step 1: Add the import and call**

Edit `src/commands/up.ts`. Add this import next to the other module imports (around line 15):

```typescript
import { ensureDokkuVersion } from '../modules/version.js'
```

Then insert the version check at the top of the orchestration body, before "Phase 1: Plugins". The existing block:

```typescript
  const apps = appFilter.length > 0
    ? appFilter
    : Object.keys(config.apps)

  // Phase 1: Plugins & host-level auth
  if (config.plugins) await ensurePlugins(ctx, config.plugins)
```

becomes:

```typescript
  const apps = appFilter.length > 0
    ? appFilter
    : Object.keys(config.apps)

  // Phase 0: Version check (warning-only, opt-in via dokku.version)
  await ensureDokkuVersion(ctx, config.dokku?.version)

  // Phase 1: Plugins & host-level auth
  if (config.plugins) await ensurePlugins(ctx, config.plugins)
```

- [ ] **Step 2: Run the full test suite**

Run: `bun test`
Expected: PASS — all existing tests still passing, no regressions.

- [ ] **Step 3: Smoke test in dry-run**

Run: `./bin/dokku-compose up --dry-run` against a fixture or local config that does NOT pin `dokku.version`.
Expected: no warning, no error, dry-run output as before.

If a `DOKKU_HOST` and a fixture with `dokku.version` set higher than the server are available, run again and confirm the warning prints. (Skip this sub-step if no test server is reachable — the unit tests cover the logic.)

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

Edit `README.md`. The Features table currently ends with the Service Links row at line 130. Add a new row above the table's first data row (alphabetical-ish placement isn't strict in this table; group it with infrastructure-level items near the top). Insert this row immediately after the `| Apps | ... |` row:

```markdown
| Dokku Version | Warn when the server's Dokku version is older than the pinned floor | [dokku](docs/reference/dokku.md) |
```

The relevant section after the edit:

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

Run: `./bin/dokku-compose validate src/tests/fixtures/<any-fixture>.yml`
Expected: no errors. (Validate is offline — version check should not run here.)
