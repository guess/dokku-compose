# Resource Reconciler Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace 16 hand-coded ensure/export modules with a composable Resource abstraction (read + onChange) backed by a generic reconciler, cached context, and precomputed change objects.

**Architecture:** Each Dokku namespace becomes a Resource definition (~5-10 lines) with `read()` and `onChange()` functions. A shared `computeChange()` produces rich change objects (added/removed/modified). A `Context` wraps the runner with query caching and command recording. All commands (up, down, diff, export, dry-run) use the same resource definitions.

**Tech Stack:** TypeScript, Zod (existing), Vitest (existing)

**Design doc:** `docs/plans/2026-03-04-resource-reconciler-design.md`

---

### Task 1: Context — cached runner wrapper

**Files:**
- Create: `src/core/context.ts`
- Test: `src/core/context.test.ts`

**Step 1: Write the failing test**

```typescript
// src/core/context.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createRunner } from './dokku.js'
import { createContext } from './context.js'

describe('createContext', () => {
  it('caches repeated query calls with same args', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('some output')
    const ctx = createContext(runner)

    const result1 = await ctx.query('nginx:report', 'myapp')
    const result2 = await ctx.query('nginx:report', 'myapp')

    expect(result1).toBe('some output')
    expect(result2).toBe('some output')
    expect(runner.query).toHaveBeenCalledTimes(1)
  })

  it('does not cache different query args', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn()
      .mockResolvedValueOnce('app1 output')
      .mockResolvedValueOnce('app2 output')
    const ctx = createContext(runner)

    const r1 = await ctx.query('nginx:report', 'app1')
    const r2 = await ctx.query('nginx:report', 'app2')

    expect(r1).toBe('app1 output')
    expect(r2).toBe('app2 output')
    expect(runner.query).toHaveBeenCalledTimes(2)
  })

  it('records commands via run() always', async () => {
    const runner = createRunner({ dryRun: false })
    runner.run = vi.fn()
    const ctx = createContext(runner)

    await ctx.run('nginx:set', 'myapp', 'client-max-body-size', '50m')
    await ctx.run('proxy:build-config', 'myapp')

    expect(ctx.commands).toEqual([
      ['nginx:set', 'myapp', 'client-max-body-size', '50m'],
      ['proxy:build-config', 'myapp'],
    ])
    expect(runner.run).toHaveBeenCalledTimes(2)
  })

  it('records but does not execute in dry-run mode', async () => {
    const runner = createRunner({ dryRun: true })
    runner.run = vi.fn()
    const ctx = createContext(runner)

    await ctx.run('apps:create', 'myapp')

    expect(ctx.commands).toEqual([['apps:create', 'myapp']])
    // runner.run is called but runner itself handles dry-run no-op
    expect(runner.run).toHaveBeenCalledTimes(1)
  })

  it('delegates check() to runner without caching', async () => {
    const runner = createRunner({ dryRun: false })
    runner.check = vi.fn().mockResolvedValue(true)
    const ctx = createContext(runner)

    const result = await ctx.check('apps:exists', 'myapp')

    expect(result).toBe(true)
    expect(runner.check).toHaveBeenCalledWith('apps:exists', 'myapp')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test src/core/context.test.ts`
Expected: FAIL — module `./context.js` not found

**Step 3: Write minimal implementation**

```typescript
// src/core/context.ts
import type { Runner } from './dokku.js'

export interface Context {
  /** Cached read-only query — same args return cached result */
  query(...args: string[]): Promise<string>
  /** Boolean check — delegates to runner, not cached */
  check(...args: string[]): Promise<boolean>
  /** Mutation — records command, executes via runner */
  run(...args: string[]): Promise<void>
  /** All commands that were run (or would be in dry-run) */
  commands: string[][]
  /** Close the underlying SSH connection */
  close(): Promise<void>
}

export function createContext(runner: Runner): Context {
  const cache = new Map<string, Promise<string>>()
  const commands: string[][] = []

  return {
    commands,

    query(...args: string[]): Promise<string> {
      const key = args.join('\0')
      if (!cache.has(key)) {
        cache.set(key, runner.query(...args))
      }
      return cache.get(key)!
    },

    check(...args: string[]): Promise<boolean> {
      return runner.check(...args)
    },

    async run(...args: string[]): Promise<void> {
      commands.push(args)
      await runner.run(...args)
    },

    close(): Promise<void> {
      return runner.close()
    },
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/core/context.test.ts`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add src/core/context.ts src/core/context.test.ts
git commit -m "feat: add Context with cached queries and command recording"
```

---

### Task 2: computeChange — generic change computation

**Files:**
- Create: `src/core/change.ts`
- Test: `src/core/change.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/core/change.test.ts
import { describe, it, expect } from 'vitest'
import { computeChange } from './change.js'

describe('computeChange — scalars', () => {
  it('detects no change for equal strings', () => {
    const c = computeChange('docker-local', 'docker-local')
    expect(c.changed).toBe(false)
  })

  it('detects change for different strings', () => {
    const c = computeChange('docker-local', 'k3s')
    expect(c.changed).toBe(true)
    expect(c.before).toBe('docker-local')
    expect(c.after).toBe('k3s')
  })

  it('detects change for booleans', () => {
    const c = computeChange(true, false)
    expect(c.changed).toBe(true)
  })

  it('detects no change for equal booleans', () => {
    const c = computeChange(false, false)
    expect(c.changed).toBe(false)
  })
})

describe('computeChange — arrays (ListChange)', () => {
  it('detects no change for same items in different order', () => {
    const c = computeChange(['b', 'a'], ['a', 'b'])
    expect(c.changed).toBe(false)
  })

  it('computes added items', () => {
    const c = computeChange(['a'], ['a', 'b', 'c'])
    expect(c.changed).toBe(true)
    expect(c.added).toEqual(['b', 'c'])
    expect(c.removed).toEqual([])
  })

  it('computes removed items', () => {
    const c = computeChange(['a', 'b', 'c'], ['a'])
    expect(c.changed).toBe(true)
    expect(c.added).toEqual([])
    expect(c.removed).toEqual(['b', 'c'])
  })

  it('computes both added and removed', () => {
    const c = computeChange(['a', 'b'], ['b', 'c'])
    expect(c.changed).toBe(true)
    expect(c.added).toEqual(['c'])
    expect(c.removed).toEqual(['a'])
  })

  it('handles empty before (all added)', () => {
    const c = computeChange([], ['a', 'b'])
    expect(c.changed).toBe(true)
    expect(c.added).toEqual(['a', 'b'])
    expect(c.removed).toEqual([])
  })
})

describe('computeChange — objects (MapChange)', () => {
  it('detects no change for equal maps', () => {
    const c = computeChange({ a: '1', b: '2' }, { a: '1', b: '2' })
    expect(c.changed).toBe(false)
  })

  it('computes added keys', () => {
    const c = computeChange({ a: '1' }, { a: '1', b: '2' })
    expect(c.changed).toBe(true)
    expect(c.added).toEqual({ b: '2' })
    expect(c.removed).toEqual([])
    expect(c.modified).toEqual({})
  })

  it('computes removed keys', () => {
    const c = computeChange({ a: '1', b: '2' }, { a: '1' })
    expect(c.changed).toBe(true)
    expect(c.added).toEqual({})
    expect(c.removed).toEqual(['b'])
    expect(c.modified).toEqual({})
  })

  it('computes modified keys', () => {
    const c = computeChange({ a: '1' }, { a: '2' })
    expect(c.changed).toBe(true)
    expect(c.added).toEqual({})
    expect(c.removed).toEqual([])
    expect(c.modified).toEqual({ a: '2' })
  })

  it('computes all three at once', () => {
    const c = computeChange(
      { keep: 'same', change: 'old', drop: 'bye' },
      { keep: 'same', change: 'new', add: 'hello' }
    )
    expect(c.changed).toBe(true)
    expect(c.added).toEqual({ add: 'hello' })
    expect(c.removed).toEqual(['drop'])
    expect(c.modified).toEqual({ change: 'new' })
  })

  it('handles empty before (all added)', () => {
    const c = computeChange({}, { a: '1', b: '2' })
    expect(c.changed).toBe(true)
    expect(c.added).toEqual({ a: '1', b: '2' })
  })
})

describe('computeChange — null/undefined (existence)', () => {
  it('detects creation (before null, after truthy)', () => {
    const c = computeChange(null, { certfile: 'a', keyfile: 'b' })
    expect(c.changed).toBe(true)
    expect(c.before).toBeNull()
  })

  it('detects destruction (before truthy, after null)', () => {
    const c = computeChange(true, null)
    expect(c.changed).toBe(true)
  })

  it('detects no change (both null)', () => {
    const c = computeChange(null, null)
    expect(c.changed).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test src/core/change.test.ts`
Expected: FAIL — module `./change.js` not found

**Step 3: Write minimal implementation**

```typescript
// src/core/change.ts
export interface Change<T = unknown> {
  before: T
  after: T
  changed: boolean
}

export interface ListChange extends Change<string[]> {
  added: string[]
  removed: string[]
}

export interface MapChange extends Change<Record<string, string>> {
  added: Record<string, string>
  removed: string[]
  modified: Record<string, string>
}

// Overloads for proper type narrowing at call sites
export function computeChange(before: string[], after: string[]): ListChange
export function computeChange(before: Record<string, string>, after: Record<string, string>): MapChange
export function computeChange<T>(before: T, after: T): Change<T>
export function computeChange(before: unknown, after: unknown): Change | ListChange | MapChange {
  // Null/undefined — existence check
  if (before === null || before === undefined || after === null || after === undefined) {
    return { before, after, changed: before !== after }
  }

  // Arrays — set-based comparison
  if (Array.isArray(before) && Array.isArray(after)) {
    const beforeSet = new Set(before)
    const afterSet = new Set(after)
    const added = after.filter(x => !beforeSet.has(x))
    const removed = before.filter(x => !afterSet.has(x))
    return {
      before, after,
      changed: added.length > 0 || removed.length > 0,
      added,
      removed,
    } satisfies ListChange
  }

  // Objects — key-level diff
  if (typeof before === 'object' && typeof after === 'object') {
    const b = before as Record<string, string>
    const a = after as Record<string, string>
    const allKeys = new Set([...Object.keys(b), ...Object.keys(a)])
    const added: Record<string, string> = {}
    const removed: string[] = []
    const modified: Record<string, string> = {}
    for (const key of allKeys) {
      if (!(key in b)) added[key] = a[key]
      else if (!(key in a)) removed.push(key)
      else if (String(b[key]) !== String(a[key])) modified[key] = a[key]
    }
    const changed = Object.keys(added).length > 0 || removed.length > 0 || Object.keys(modified).length > 0
    return { before, after, changed, added, removed, modified } satisfies MapChange
  }

  // Scalars
  return { before, after, changed: before !== after } satisfies Change
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/core/change.test.ts`
Expected: PASS (all tests)

**Step 5: Commit**

```bash
git add src/core/change.ts src/core/change.test.ts
git commit -m "feat: add computeChange with scalar, list, and map diffing"
```

---

### Task 3: reconcile() — generic convergence loop

**Files:**
- Create: `src/core/reconcile.ts`
- Test: `src/core/reconcile.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/core/reconcile.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createRunner } from './dokku.js'
import { createContext } from './context.js'
import { reconcile } from './reconcile.js'
import type { Resource } from './reconcile.js'

describe('reconcile', () => {
  function makeCtx() {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
    runner.run = vi.fn()
    runner.check = vi.fn().mockResolvedValue(false)
    return createContext(runner)
  }

  it('calls onChange when state differs', async () => {
    const ctx = makeCtx()
    const onChange = vi.fn()
    const resource: Resource<string> = {
      key: 'scheduler',
      read: async () => 'docker-local',
      onChange,
    }

    await reconcile(resource, ctx, 'myapp', 'k3s')

    expect(onChange).toHaveBeenCalledTimes(1)
    const change = onChange.mock.calls[0][2]
    expect(change.before).toBe('docker-local')
    expect(change.after).toBe('k3s')
    expect(change.changed).toBe(true)
  })

  it('skips onChange when state matches', async () => {
    const ctx = makeCtx()
    const onChange = vi.fn()
    const resource: Resource<string> = {
      key: 'scheduler',
      read: async () => 'docker-local',
      onChange,
    }

    await reconcile(resource, ctx, 'myapp', 'docker-local')

    expect(onChange).not.toHaveBeenCalled()
  })

  it('skips entirely when desired is undefined', async () => {
    const ctx = makeCtx()
    const read = vi.fn()
    const resource: Resource<string> = {
      key: 'scheduler',
      read,
      onChange: vi.fn(),
    }

    await reconcile(resource, ctx, 'myapp', undefined)

    expect(read).not.toHaveBeenCalled()
  })

  it('passes list change with added/removed for arrays', async () => {
    const ctx = makeCtx()
    const onChange = vi.fn()
    const resource: Resource<string[]> = {
      key: 'ports',
      read: async () => ['http:80:3000'],
      onChange,
    }

    await reconcile(resource, ctx, 'myapp', ['http:80:3000', 'https:443:3000'])

    const change = onChange.mock.calls[0][2]
    expect(change.added).toEqual(['https:443:3000'])
    expect(change.removed).toEqual([])
  })

  it('passes map change with added/removed/modified for objects', async () => {
    const ctx = makeCtx()
    const onChange = vi.fn()
    const resource: Resource<Record<string, string>> = {
      key: 'nginx',
      read: async () => ({ 'client-max-body-size': '1m', 'old-prop': 'x' }),
      onChange,
    }

    await reconcile(resource, ctx, 'myapp', {
      'client-max-body-size': '50m',
      'new-prop': 'y',
    })

    const change = onChange.mock.calls[0][2]
    expect(change.modified).toEqual({ 'client-max-body-size': '50m' })
    expect(change.added).toEqual({ 'new-prop': 'y' })
    expect(change.removed).toEqual(['old-prop'])
  })

  it('always calls onChange when forceApply is true', async () => {
    const ctx = makeCtx()
    const onChange = vi.fn()
    const read = vi.fn()
    const resource: Resource<{ build: string[] }> = {
      key: 'docker_options',
      forceApply: true,
      read,
      onChange,
    }

    await reconcile(resource, ctx, 'myapp', { build: ['--shm-size=256m'] })

    expect(read).not.toHaveBeenCalled()  // read is skipped
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][2].after).toEqual({ build: ['--shm-size=256m'] })
  })

  it('logs action and result via logger', async () => {
    const ctx = makeCtx()
    const resource: Resource<string> = {
      key: 'scheduler',
      read: async () => 'docker-local',
      onChange: vi.fn(),
    }

    // Just verifying no throws — logging is a side effect
    await reconcile(resource, ctx, 'myapp', 'k3s')
    await reconcile(resource, ctx, 'myapp', 'docker-local')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test src/core/reconcile.test.ts`
Expected: FAIL — module `./reconcile.js` not found

**Step 3: Write minimal implementation**

```typescript
// src/core/reconcile.ts
import type { Context } from './context.js'
import { computeChange } from './change.js'
import { logAction, logDone, logSkip } from './logger.js'

export interface Resource<T = unknown> {
  key: string
  read: (ctx: Context, target: string) => Promise<T>
  onChange: (ctx: Context, target: string, change: any) => void | Promise<void>
  /** Skip diff, always call onChange. For resources without parseable reports. */
  forceApply?: boolean
}

export async function reconcile<T>(
  resource: Resource<T>,
  ctx: Context,
  target: string,
  desired: T | undefined
): Promise<void> {
  if (desired === undefined) return
  logAction(target, `${resource.key}`)

  if (resource.forceApply) {
    await resource.onChange(ctx, target, { before: undefined, after: desired, changed: true })
    logDone()
    return
  }

  const before = await resource.read(ctx, target)
  const change = computeChange(before, desired)
  if (!change.changed) {
    logSkip()
    return
  }
  await resource.onChange(ctx, target, change)
  logDone()
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/core/reconcile.test.ts`
Expected: PASS (all tests)

**Step 5: Commit**

```bash
git add src/core/reconcile.ts src/core/reconcile.test.ts
git commit -m "feat: add generic reconcile loop with Resource interface"
```

---

### Task 4: Resource definitions — property-based (nginx, logs, registry, scheduler)

These all share the same `report`-parsing read pattern with namespace-specific onChange.

**Files:**
- Create: `src/resources/properties.ts`
- Create: `src/resources/parsers.ts` (shared report parser)
- Test: `src/resources/properties.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/resources/properties.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { reconcile } from '../core/reconcile.js'
import { Nginx, Logs, Registry, Scheduler } from './properties.js'

describe('Nginx resource', () => {
  function makeCtx() {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
    runner.run = vi.fn()
    return createContext(runner)
  }

  it('sets only modified nginx properties', async () => {
    const ctx = makeCtx()
    ;(ctx.runner.query as any).mockResolvedValue(
      '       Nginx client max body size:   1m\n       Nginx proxy read timeout:   60s\n'
    )
    await reconcile(Nginx, ctx, 'myapp', {
      'client-max-body-size': '50m',
      'proxy-read-timeout': '60s',
    })
    expect(ctx.commands).toEqual([
      ['nginx:set', 'myapp', 'client-max-body-size', '50m'],
      ['proxy:build-config', 'myapp'],
    ])
  })

  it('skips when all nginx properties match', async () => {
    const ctx = makeCtx()
    ;(ctx.runner.query as any).mockResolvedValue(
      '       Nginx client max body size:   50m\n'
    )
    await reconcile(Nginx, ctx, 'myapp', { 'client-max-body-size': '50m' })
    expect(ctx.commands).toEqual([])
  })
})

describe('Scheduler resource', () => {
  function makeCtx() {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
    runner.run = vi.fn()
    return createContext(runner)
  }

  it('sets scheduler when different', async () => {
    const ctx = makeCtx()
    ;(ctx.runner.query as any).mockResolvedValue(
      '       Scheduler selected:            docker-local\n'
    )
    await reconcile(Scheduler, ctx, 'myapp', 'k3s')
    expect(ctx.commands).toEqual([
      ['scheduler:set', 'myapp', 'selected', 'k3s'],
    ])
  })

  it('skips when scheduler matches', async () => {
    const ctx = makeCtx()
    ;(ctx.runner.query as any).mockResolvedValue(
      '       Scheduler selected:            docker-local\n'
    )
    await reconcile(Scheduler, ctx, 'myapp', 'docker-local')
    expect(ctx.commands).toEqual([])
  })
})

describe('Logs resource', () => {
  function makeCtx() {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
    runner.run = vi.fn()
    return createContext(runner)
  }

  it('sets only modified log properties', async () => {
    const ctx = makeCtx()
    ;(ctx.runner.query as any).mockResolvedValue(
      '       Logs max size:                 10m\n'
    )
    await reconcile(Logs, ctx, 'myapp', { 'max-size': '20m' })
    expect(ctx.commands).toEqual([
      ['logs:set', 'myapp', 'max-size', '20m'],
    ])
  })
})

describe('Registry resource', () => {
  function makeCtx() {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
    runner.run = vi.fn()
    return createContext(runner)
  }

  it('sets only modified registry properties', async () => {
    const ctx = makeCtx()
    ;(ctx.runner.query as any).mockResolvedValue(
      '       Registry server:               \n       Registry push on release:       false\n'
    )
    await reconcile(Registry, ctx, 'myapp', {
      server: 'docker.io',
      'push-on-release': 'true',
    })
    // server was empty -> added, push-on-release was false -> modified
    expect(ctx.commands.length).toBeGreaterThan(0)
  })
})
```

Also add parser-specific tests with real Dokku output samples in a separate file:

```typescript
// src/resources/parsers.test.ts
import { describe, it, expect } from 'vitest'
import { parseReport } from './parsers.js'

describe('parseReport', () => {
  it('parses nginx report format', () => {
    // Real output from dokku nginx:report myapp
    const raw = `=====> myapp nginx information
       Nginx access log format:
       Nginx access log path:           /var/log/nginx/myapp-access.log
       Nginx bind address IPv4:
       Nginx bind address IPv6:         ::
       Nginx client max body size:      1m
       Nginx disable custom config:     false
       Nginx error log path:            /var/log/nginx/myapp-error.log
       Nginx global hsts:               true
       Nginx hsts:                       true
       Nginx hsts include subdomains:   true
       Nginx hsts max age:              15724800
       Nginx hsts preload:              false
       Nginx last visited at:           1709561234
       Nginx proxy buffer size:         4096
       Nginx proxy buffering:           on
       Nginx proxy buffers:             8 4096
       Nginx proxy read timeout:        60s`
    const result = parseReport(raw, 'nginx')
    expect(result['client-max-body-size']).toBe('1m')
    expect(result['proxy-read-timeout']).toBe('60s')
    expect(result['hsts']).toBe('true')
    // Should skip computed/meta keys
    expect(result['last-visited-at']).toBeUndefined()
    // Should skip empty values
    expect(result['access-log-format']).toBeUndefined()
    expect(result['bind-address-ipv4']).toBeUndefined()
  })

  it('parses scheduler report format', () => {
    const raw = `=====> myapp scheduler information
       Scheduler computed selected:     docker-local
       Scheduler global selected:       docker-local
       Scheduler selected:              docker-local`
    const result = parseReport(raw, 'scheduler')
    expect(result['selected']).toBe('docker-local')
    // Should skip computed/global keys
    expect(result['computed-selected']).toBeUndefined()
    expect(result['global-selected']).toBeUndefined()
  })

  it('parses logs report format', () => {
    const raw = `=====> myapp logs information
       Logs computed max size:          10m
       Logs global max size:
       Logs max size:                   10m
       Logs computed vector sink:
       Logs global vector sink:
       Logs vector sink:`
    const result = parseReport(raw, 'logs')
    expect(result['max-size']).toBe('10m')
    expect(result['computed-max-size']).toBeUndefined()
  })

  it('handles header line gracefully', () => {
    const raw = `=====> myapp nginx information
       Nginx client max body size:      50m`
    const result = parseReport(raw, 'nginx')
    expect(result['client-max-body-size']).toBe('50m')
    // Header line should not appear as a key
    expect(Object.keys(result)).not.toContain('=====> myapp nginx information')
  })

  it('returns empty object for empty input', () => {
    expect(parseReport('', 'nginx')).toEqual({})
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test src/resources/parsers.test.ts src/resources/properties.test.ts`
Expected: FAIL — modules not found

**Step 3: Write implementation**

```typescript
// src/resources/parsers.ts
/**
 * Parse Dokku report output into a key-value map.
 * Report format: "       Namespace key name:   value"
 * Keys are normalized: lowercase, spaces→hyphens, namespace prefix stripped.
 */
export function parseReport(raw: string, namespace: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    // Match: optional whitespace, Namespace label, colon, value
    const match = line.match(/^\s*\w[\w\s]+?:\s*(.*?)\s*$/)
    if (!match) continue
    // Extract the key portion (everything before the last colon on the left)
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const rawKey = line.slice(0, colonIdx).trim()
    // Strip the namespace prefix (e.g. "Nginx client max body size" -> "client max body size")
    const prefix = new RegExp(`^${namespace}\\s+`, 'i')
    const stripped = rawKey.replace(prefix, '')
    const key = stripped.toLowerCase().replace(/\s+/g, '-')
    // Skip computed/global/meta keys
    if (key.startsWith('computed-') || key.startsWith('global-') || key === 'last-visited-at') continue
    const value = match[1]
    if (value) result[key] = value
  }
  return result
}
```

```typescript
// src/resources/properties.ts
import type { Resource } from '../core/reconcile.js'
import type { MapChange, Change } from '../core/change.js'
import { parseReport } from './parsers.js'

function propertyResource(opts: {
  key: string
  namespace: string
  setCmd: string
  afterChange?: string[]  // extra commands to run after changes (e.g. proxy:build-config)
}): Resource<Record<string, string | number>> {
  return {
    key: opts.key,
    read: async (ctx, target) => {
      const raw = await ctx.query(`${opts.namespace}:report`, target)
      return parseReport(raw, opts.namespace)
    },
    onChange: async (ctx, target, change: MapChange) => {
      for (const [key, value] of Object.entries({ ...change.added, ...change.modified })) {
        await ctx.run(opts.setCmd, target, key, String(value))
      }
      if (opts.afterChange) {
        for (const cmd of opts.afterChange) {
          await ctx.run(cmd, target)
        }
      }
    },
  }
}

export const Nginx = propertyResource({
  key: 'nginx',
  namespace: 'nginx',
  setCmd: 'nginx:set',
  afterChange: ['proxy:build-config'],
})

export const Logs = propertyResource({
  key: 'logs',
  namespace: 'logs',
  setCmd: 'logs:set',
})

export const Registry = propertyResource({
  key: 'registry',
  namespace: 'registry',
  setCmd: 'registry:set',
})

// Scheduler is a scalar (single value) but read from report
export const Scheduler: Resource<string> = {
  key: 'scheduler',
  read: async (ctx, target) => {
    const report = parseReport(
      await ctx.query('scheduler:report', target),
      'scheduler'
    )
    return report['selected'] ?? ''
  },
  onChange: async (ctx, target, change: Change<string>) => {
    await ctx.run('scheduler:set', target, 'selected', change.after)
  },
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/resources/properties.test.ts`
Expected: PASS (all tests)

**Step 5: Commit**

```bash
git add src/resources/parsers.ts src/resources/parsers.test.ts src/resources/properties.ts src/resources/properties.test.ts
git commit -m "feat: add property-based resources (nginx, logs, registry, scheduler)"
```

---

### Task 5: Resource definitions — lists (ports, domains, storage)

**Files:**
- Create: `src/resources/lists.ts`
- Test: `src/resources/lists.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/resources/lists.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { reconcile } from '../core/reconcile.js'
import { Ports, Domains, Storage } from './lists.js'

describe('Ports resource', () => {
  function makeCtx() {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
    runner.run = vi.fn()
    return createContext(runner)
  }

  it('sets ports when different', async () => {
    const ctx = makeCtx()
    ;(ctx.runner.query as any).mockResolvedValue('http:80:4000')
    await reconcile(Ports, ctx, 'myapp', ['http:80:3000'])
    expect(ctx.commands).toEqual([['ports:set', 'myapp', 'http:80:3000']])
  })

  it('skips when ports match (different order)', async () => {
    const ctx = makeCtx()
    ;(ctx.runner.query as any).mockResolvedValue('https:443:3000 http:80:3000')
    await reconcile(Ports, ctx, 'myapp', ['http:80:3000', 'https:443:3000'])
    expect(ctx.commands).toEqual([])
  })
})

describe('Domains resource', () => {
  function makeCtx() {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
    runner.run = vi.fn()
    return createContext(runner)
  }

  it('adds new domains and removes old ones', async () => {
    const ctx = makeCtx()
    ;(ctx.runner.query as any).mockResolvedValue('old.example.com\nkeep.example.com')
    await reconcile(Domains, ctx, 'myapp', ['keep.example.com', 'new.example.com'])
    expect(ctx.commands).toContainEqual(['domains:remove', 'myapp', 'old.example.com'])
    expect(ctx.commands).toContainEqual(['domains:add', 'myapp', 'new.example.com'])
  })

  it('skips when domains match', async () => {
    const ctx = makeCtx()
    ;(ctx.runner.query as any).mockResolvedValue('example.com')
    await reconcile(Domains, ctx, 'myapp', ['example.com'])
    expect(ctx.commands).toEqual([])
  })
})

describe('Storage resource', () => {
  function makeCtx() {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
    runner.run = vi.fn()
    return createContext(runner)
  }

  it('mounts new and unmounts removed storage', async () => {
    const ctx = makeCtx()
    ;(ctx.runner.query as any).mockResolvedValue('/old:/app/old')
    await reconcile(Storage, ctx, 'myapp', ['/new:/app/new'])
    expect(ctx.commands).toContainEqual(['storage:unmount', 'myapp', '/old:/app/old'])
    expect(ctx.commands).toContainEqual(['storage:mount', 'myapp', '/new:/app/new'])
  })

  it('skips when storage matches', async () => {
    const ctx = makeCtx()
    ;(ctx.runner.query as any).mockResolvedValue('/data:/app/data')
    await reconcile(Storage, ctx, 'myapp', ['/data:/app/data'])
    expect(ctx.commands).toEqual([])
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test src/resources/lists.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// src/resources/lists.ts
import type { Resource } from '../core/reconcile.js'
import type { ListChange } from '../core/change.js'

function splitWords(raw: string): string[] {
  return raw.split(/\s+/).map(s => s.trim()).filter(Boolean)
}

function splitLines(raw: string): string[] {
  return raw.split('\n').map(s => s.trim()).filter(Boolean)
}

export const Ports: Resource<string[]> = {
  key: 'ports',
  read: async (ctx, target) => {
    const raw = await ctx.query('ports:report', target, '--ports-map')
    return splitWords(raw)
  },
  onChange: async (ctx, target, change: ListChange) => {
    // Ports uses replace-all semantics
    await ctx.run('ports:set', target, ...change.after)
  },
}

export const Domains: Resource<string[]> = {
  key: 'domains',
  read: async (ctx, target) => {
    const raw = await ctx.query('domains:report', target, '--domains-app-vhosts')
    return splitLines(raw)
  },
  onChange: async (ctx, target, { added, removed }: ListChange) => {
    for (const d of removed) await ctx.run('domains:remove', target, d)
    for (const d of added) await ctx.run('domains:add', target, d)
  },
}

export const Storage: Resource<string[]> = {
  key: 'storage',
  read: async (ctx, target) => {
    const raw = await ctx.query('storage:report', target, '--storage-mounts')
    return splitLines(raw)
  },
  onChange: async (ctx, target, { added, removed }: ListChange) => {
    for (const m of removed) await ctx.run('storage:unmount', target, m)
    for (const m of added) await ctx.run('storage:mount', target, m)
  },
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/resources/lists.test.ts`
Expected: PASS (all tests)

**Step 5: Commit**

```bash
git add src/resources/lists.ts src/resources/lists.test.ts
git commit -m "feat: add list-based resources (ports, domains, storage)"
```

---

### Task 6: Resource definitions — remaining types (proxy, certs, config, apps, docker-options, builder, git, checks, network)

**Files:**
- Create: `src/resources/toggle.ts` (proxy)
- Create: `src/resources/config.ts` (env vars with managed keys)
- Create: `src/resources/lifecycle.ts` (apps)
- Create: `src/resources/certs.ts`
- Create: `src/resources/docker-options.ts`
- Create: `src/resources/builder.ts`
- Create: `src/resources/git.ts`
- Create: `src/resources/checks.ts`
- Create: `src/resources/network.ts`
- Test: `src/resources/toggle.test.ts`
- Test: `src/resources/config.test.ts`
- Test: `src/resources/lifecycle.test.ts`

This is a larger task. Split into sub-steps per resource group.

**Step 1: Write failing tests for proxy, apps, config**

```typescript
// src/resources/toggle.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { reconcile } from '../core/reconcile.js'
import { Proxy } from './toggle.js'

describe('Proxy resource', () => {
  function makeCtx() {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
    runner.run = vi.fn()
    return createContext(runner)
  }

  it('enables proxy when currently disabled', async () => {
    const ctx = makeCtx()
    ;(ctx.runner.query as any).mockResolvedValue('false')
    await reconcile(Proxy, ctx, 'myapp', true)
    expect(ctx.commands).toEqual([['proxy:enable', 'myapp']])
  })

  it('disables proxy when currently enabled', async () => {
    const ctx = makeCtx()
    ;(ctx.runner.query as any).mockResolvedValue('true')
    await reconcile(Proxy, ctx, 'myapp', false)
    expect(ctx.commands).toEqual([['proxy:disable', 'myapp']])
  })

  it('skips when proxy already matches', async () => {
    const ctx = makeCtx()
    ;(ctx.runner.query as any).mockResolvedValue('true')
    await reconcile(Proxy, ctx, 'myapp', true)
    expect(ctx.commands).toEqual([])
  })
})
```

```typescript
// src/resources/lifecycle.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { reconcile } from '../core/reconcile.js'
import { Apps } from './lifecycle.js'

describe('Apps resource', () => {
  function makeCtx() {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
    runner.run = vi.fn()
    runner.check = vi.fn().mockResolvedValue(false)
    return createContext(runner)
  }

  it('creates app when it does not exist', async () => {
    const ctx = makeCtx()
    ;(ctx.runner.check as any).mockResolvedValue(false)
    await reconcile(Apps, ctx, 'myapp', true)
    expect(ctx.commands).toEqual([['apps:create', 'myapp']])
  })

  it('skips when app already exists', async () => {
    const ctx = makeCtx()
    ;(ctx.runner.check as any).mockResolvedValue(true)
    await reconcile(Apps, ctx, 'myapp', true)
    expect(ctx.commands).toEqual([])
  })

  it('destroys app when desired is false', async () => {
    const ctx = makeCtx()
    ;(ctx.runner.check as any).mockResolvedValue(true)
    await reconcile(Apps, ctx, 'myapp', false)
    expect(ctx.commands).toEqual([['apps:destroy', 'myapp', '--force']])
  })
})
```

```typescript
// src/resources/config.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { reconcile } from '../core/reconcile.js'
import { Config } from './config.js'

describe('Config resource', () => {
  function makeCtx() {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
    runner.run = vi.fn()
    return createContext(runner)
  }

  it('sets env vars and updates managed keys', async () => {
    const ctx = makeCtx()
    ;(ctx.runner.query as any)
      .mockResolvedValueOnce('')  // managed keys query
      .mockResolvedValueOnce("export DOKKU_COMPOSE_MANAGED_KEYS=''\n")  // export
    await reconcile(Config, ctx, 'myapp', { SECRET: 'abc', PORT: '3000' })
    const setCmds = ctx.commands.filter(c => c[0] === 'config:set')
    expect(setCmds.length).toBe(1)
    expect(setCmds[0]).toContain('SECRET=abc')
    expect(setCmds[0]).toContain('PORT=3000')
  })

  it('unsets keys removed from desired', async () => {
    const ctx = makeCtx()
    ;(ctx.runner.query as any)
      .mockResolvedValueOnce('OLD_KEY,KEEP_KEY')  // managed keys
      .mockResolvedValueOnce("export OLD_KEY='x'\nexport KEEP_KEY='y'\nexport DOKKU_COMPOSE_MANAGED_KEYS='OLD_KEY,KEEP_KEY'\n")
    await reconcile(Config, ctx, 'myapp', { KEEP_KEY: 'y' })
    const unsetCmds = ctx.commands.filter(c => c[0] === 'config:unset')
    expect(unsetCmds.length).toBe(1)
    expect(unsetCmds[0]).toContain('OLD_KEY')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/resources/toggle.test.ts src/resources/lifecycle.test.ts src/resources/config.test.ts`
Expected: FAIL — modules not found

**Step 3: Write implementations**

```typescript
// src/resources/toggle.ts
import type { Resource } from '../core/reconcile.js'
import type { Change } from '../core/change.js'

export const Proxy: Resource<boolean> = {
  key: 'proxy',
  read: async (ctx, target) => {
    const raw = await ctx.query('proxy:report', target, '--proxy-enabled')
    return raw.trim() === 'true'
  },
  onChange: async (ctx, target, { after }: Change<boolean>) => {
    await ctx.run(after ? 'proxy:enable' : 'proxy:disable', target)
  },
}
```

```typescript
// src/resources/lifecycle.ts
import type { Resource } from '../core/reconcile.js'
import type { Change } from '../core/change.js'

export const Apps: Resource<boolean> = {
  key: '_app',
  read: async (ctx, target) => {
    return ctx.check('apps:exists', target)
  },
  onChange: async (ctx, target, { after }: Change<boolean>) => {
    if (after) {
      await ctx.run('apps:create', target)
    } else {
      await ctx.run('apps:destroy', target, '--force')
    }
  },
}
```

```typescript
// src/resources/config.ts
import type { Resource } from '../core/reconcile.js'
import type { MapChange } from '../core/change.js'

const MANAGED_KEYS_VAR = 'DOKKU_COMPOSE_MANAGED_KEYS'

export const Config: Resource<Record<string, string | number | boolean>> = {
  key: 'env',
  read: async (ctx, target) => {
    // Read the managed keys to know our scope
    const managedRaw = await ctx.query('config:get', target, MANAGED_KEYS_VAR)
    const managedKeys = managedRaw.trim() ? managedRaw.trim().split(',').filter(Boolean) : []
    // Return only managed keys as "before" — we only diff what we own
    const result: Record<string, string> = {}
    if (managedKeys.length > 0) {
      const raw = await ctx.query('config:export', target, '--format', 'shell')
      for (const line of raw.split('\n')) {
        const match = line.match(/^export\s+(\w+)=['"]?(.*?)['"]?$/)
        if (match && managedKeys.includes(match[1])) {
          result[match[1]] = match[2]
        }
      }
    }
    return result
  },
  onChange: async (ctx, target, change: MapChange) => {
    const { added, removed, modified } = change
    // Unset removed keys
    if (removed.length > 0) {
      await ctx.run('config:unset', '--no-restart', target, ...removed)
    }
    // Set added + modified keys + update managed keys list
    const toSet = { ...added, ...modified }
    const allDesiredKeys = Object.keys(change.after)
    const managedValue = allDesiredKeys.join(',')
    if (Object.keys(toSet).length > 0 || removed.length > 0) {
      const pairs = Object.entries(change.after).map(([k, v]) => `${k}=${v}`)
      await ctx.run(
        'config:set', '--no-restart', target,
        ...pairs,
        `${MANAGED_KEYS_VAR}=${managedValue}`
      )
    }
  },
}
```

```typescript
// src/resources/certs.ts
import type { Resource } from '../core/reconcile.js'
import type { Change } from '../core/change.js'

type SslValue = false | true | { certfile: string; keyfile: string }

export const Certs: Resource<SslValue> = {
  key: 'ssl',
  read: async (ctx, target) => {
    const raw = await ctx.query('certs:report', target, '--ssl-enabled')
    return raw.trim() === 'true'
  },
  onChange: async (ctx, target, { before, after }: Change<SslValue>) => {
    if (after === false && before) {
      await ctx.run('certs:remove', target)
    }
    if (after && typeof after === 'object') {
      await ctx.run('certs:add', target, after.certfile, after.keyfile)
    }
  },
}
```

```typescript
// src/resources/docker-options.ts
import type { Resource } from '../core/reconcile.js'

type DockerOpts = { build?: string[]; deploy?: string[]; run?: string[] }

export const DockerOptions: Resource<DockerOpts> = {
  key: 'docker_options',
  forceApply: true,
  read: async () => ({} as DockerOpts),
  onChange: async (ctx, target, { after }: { after: DockerOpts }) => {
    for (const phase of ['build', 'deploy', 'run'] as const) {
      const opts = after[phase]
      if (!opts || opts.length === 0) continue
      await ctx.run('docker-options:clear', target, phase)
      for (const opt of opts) {
        await ctx.run('docker-options:add', target, phase, opt)
      }
    }
  },
}
```

```typescript
// src/resources/builder.ts
import type { Resource } from '../core/reconcile.js'

type BuildConfig = {
  dockerfile?: string
  app_json?: string
  context?: string
  args?: Record<string, string>
}

export const Builder: Resource<BuildConfig> = {
  key: 'build',
  forceApply: true,
  read: async () => ({} as BuildConfig),
  onChange: async (ctx, target, { after }: { after: BuildConfig }) => {
    if (after.dockerfile)
      await ctx.run('builder-dockerfile:set', target, 'dockerfile-path', after.dockerfile)
    if (after.app_json)
      await ctx.run('app-json:set', target, 'appjson-path', after.app_json)
    if (after.context)
      await ctx.run('builder:set', target, 'build-dir', after.context)
    if (after.args) {
      for (const [key, value] of Object.entries(after.args)) {
        await ctx.run('docker-options:add', target, 'build', `--build-arg ${key}=${value}`)
      }
    }
  },
}
```

```typescript
// src/resources/git.ts
import type { Resource } from '../core/reconcile.js'

type GitConfig = { deploy_branch?: string }

export const Git: Resource<GitConfig> = {
  key: 'git',
  read: async (ctx, target) => {
    const report = await ctx.query('git:report', target, '--git-deploy-branch')
    return { deploy_branch: report.trim() || undefined }
  },
  onChange: async (ctx, target, { after }: { after: GitConfig }) => {
    if (after.deploy_branch) {
      await ctx.run('git:set', target, 'deploy-branch', after.deploy_branch)
    }
  },
}
```

```typescript
// src/resources/checks.ts
import type { Resource } from '../core/reconcile.js'
import type { Change } from '../core/change.js'

type ChecksConfig = false | {
  disabled?: string[]
  skipped?: string[]
  [key: string]: string | number | boolean | string[] | undefined
}

export const Checks: Resource<ChecksConfig> = {
  key: 'checks',
  forceApply: true,
  read: async () => ({} as ChecksConfig),
  onChange: async (ctx, target, { after }: Change<ChecksConfig>) => {
    if (after === false) {
      await ctx.run('checks:disable', target)
      return
    }
    if (after.disabled && after.disabled.length > 0) {
      await ctx.run('checks:disable', target, ...after.disabled)
    }
    if (after.skipped && after.skipped.length > 0) {
      await ctx.run('checks:skip', target, ...after.skipped)
    }
    for (const [key, value] of Object.entries(after)) {
      if (key === 'disabled' || key === 'skipped') continue
      await ctx.run('checks:set', target, key, String(value))
    }
  },
}
```

```typescript
// src/resources/network.ts
import type { Resource } from '../core/reconcile.js'
import type { ListChange, Change } from '../core/change.js'

// Network attachments (the `networks` array field)
export const Networks: Resource<string[]> = {
  key: 'networks',
  read: async (ctx, target) => {
    const raw = await ctx.query('network:report', target, '--network-attach-post-deploy')
    return raw.trim() ? raw.trim().split(/\s+/) : []
  },
  onChange: async (ctx, target, { after }: ListChange) => {
    await ctx.run('network:set', target, 'attach-post-deploy', ...after)
  },
}

// Network properties (the `network` object field)
type NetworkProps = {
  attach_post_create?: string[] | false
  initial_network?: string | false
  bind_all_interfaces?: boolean
  tld?: string | false
}

export const NetworkProps: Resource<NetworkProps> = {
  key: 'network',
  forceApply: true,
  read: async () => ({} as NetworkProps),
  onChange: async (ctx, target, { after }: Change<NetworkProps>) => {
    if (after.attach_post_create !== undefined && after.attach_post_create !== false) {
      const nets = Array.isArray(after.attach_post_create)
        ? after.attach_post_create : [after.attach_post_create]
      await ctx.run('network:set', target, 'attach-post-create', ...nets)
    }
    if (after.initial_network !== undefined && after.initial_network !== false) {
      await ctx.run('network:set', target, 'initial-network', after.initial_network)
    }
    if (after.bind_all_interfaces !== undefined) {
      await ctx.run('network:set', target, 'bind-all-interfaces', String(after.bind_all_interfaces))
    }
    if (after.tld !== undefined && after.tld !== false) {
      await ctx.run('network:set', target, 'tld', after.tld)
    }
  },
}
```

**Step 4: Run all tests to verify they pass**

Run: `bun test src/resources/`
Expected: PASS (all tests)

**Step 5: Commit**

```bash
git add src/resources/
git commit -m "feat: add all resource definitions (toggle, lifecycle, config, certs, docker-options, builder, git, checks, network)"
```

---

### Task 7: Resource registry and new up.ts

Wire all resources into a registry array and rewrite `up.ts` to use `reconcile()`.

**Files:**
- Create: `src/resources/index.ts` (registry)
- Modify: `src/commands/up.ts`
- Test: `src/commands/up.test.ts` (new — test the full orchestration with mocked context)

**Step 1: Write the failing test**

```typescript
// src/commands/up.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { runUp } from './up.js'
import type { Config } from '../core/schema.js'

describe('runUp', () => {
  function makeCtx() {
    const runner = createRunner({ dryRun: true })
    runner.query = vi.fn().mockResolvedValue('')
    runner.run = vi.fn()
    runner.check = vi.fn().mockResolvedValue(false)
    return createContext(runner)
  }

  it('creates app and sets ports via resource reconciler', async () => {
    const ctx = makeCtx()
    const config: Config = {
      apps: {
        myapp: {
          ports: ['http:80:3000'],
        },
      },
    }
    await runUp(ctx, config, [])

    // Should have created the app and set ports
    const cmds = ctx.commands.map(c => c[0])
    expect(cmds).toContain('apps:create')
    expect(cmds).toContain('ports:set')
  })

  it('respects app filter', async () => {
    const ctx = makeCtx()
    const config: Config = {
      apps: {
        app1: { ports: ['http:80:3000'] },
        app2: { ports: ['http:80:4000'] },
      },
    }
    await runUp(ctx, config, ['app1'])

    const targets = ctx.commands
      .filter(c => c[0] === 'apps:create')
      .map(c => c[1])
    expect(targets).toEqual(['app1'])
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test src/commands/up.test.ts`
Expected: FAIL (current up.ts takes Runner, not Context)

**Step 3: Write the resource registry and new up.ts**

```typescript
// src/resources/index.ts
import { Apps } from './lifecycle.js'
import { Domains, Ports, Storage } from './lists.js'
import { Nginx, Logs, Registry, Scheduler } from './properties.js'
import { Proxy } from './toggle.js'
import { Config } from './config.js'
import { Certs } from './certs.js'
import { Builder } from './builder.js'
import { DockerOptions } from './docker-options.js'
import { Git } from './git.js'
import { Checks } from './checks.js'
import { Networks, NetworkProps } from './network.js'
import type { Resource } from '../core/reconcile.js'

// Per-app resources split into explicit phases.
// Links are NOT in any phase — handled explicitly between
// NETWORKING and CONFIG because they depend on services (Phase 1).
export const NETWORKING_RESOURCES: Resource[] = [
  Domains, Networks, NetworkProps, Proxy, Ports,
]

export const CONFIG_RESOURCES: Resource[] = [
  Certs, Storage, Nginx, Checks, Logs, Registry, Scheduler, Config,
]

export const BUILD_RESOURCES: Resource[] = [
  Builder, Git, DockerOptions,
]

// All per-app resources (for export and diff iteration)
export const ALL_APP_RESOURCES: Resource[] = [
  ...NETWORKING_RESOURCES, ...CONFIG_RESOURCES, ...BUILD_RESOURCES,
]

export {
  Apps, Domains, Ports, Storage, Nginx, Logs, Registry,
  Scheduler, Proxy, Config, Certs, Builder, DockerOptions,
  Git, Checks, Networks, NetworkProps,
}
```

Rewrite `src/commands/up.ts`:

```typescript
// src/commands/up.ts
import type { Context } from '../core/context.js'
import type { Config as ConfigType } from '../core/schema.js'
import { reconcile } from '../core/reconcile.js'
import {
  NETWORKING_RESOURCES, CONFIG_RESOURCES, BUILD_RESOURCES,
  Apps, Git,
} from '../resources/index.js'
import { ensurePlugins } from '../modules/plugins.js'
import { ensureNetworks } from '../modules/network.js'
import { ensureServices, ensureServiceBackups, ensureAppLinks } from '../modules/services.js'

export async function runUp(
  ctx: Context,
  config: ConfigType,
  appFilter: string[]
): Promise<void> {
  const apps = appFilter.length > 0
    ? appFilter
    : Object.keys(config.apps)

  // Phase 1: Infrastructure
  if (config.plugins) await ensurePlugins(ctx, config.plugins)
  // TODO: wire global resources in a follow-up
  if (config.networks) await ensureNetworks(ctx, config.networks)
  if (config.services) await ensureServices(ctx, config.services)
  if (config.services) await ensureServiceBackups(ctx, config.services)

  // Phase 2: Per-app
  for (const app of apps) {
    const appConfig = config.apps[app]
    if (!appConfig) continue

    // 2a: Lifecycle
    await reconcile(Apps, ctx, app, true)

    // 2b: Networking
    for (const resource of NETWORKING_RESOURCES) {
      await reconcile(resource, ctx, app, (appConfig as any)[resource.key])
    }

    // Links — between networking and config because they depend on
    // services existing (Phase 1) and app existing (2a).
    if (config.services) {
      await ensureAppLinks(ctx, app, appConfig.links ?? [], config.services)
    }

    // 2c: Configuration
    for (const resource of CONFIG_RESOURCES) {
      await reconcile(resource, ctx, app, (appConfig as any)[resource.key])
    }

    // 2d: Build (git merges app-level with global)
    for (const resource of BUILD_RESOURCES) {
      if (resource.key === 'git') {
        await reconcile(resource, ctx, app, appConfig.git ?? config.git)
      } else {
        await reconcile(resource, ctx, app, (appConfig as any)[resource.key])
      }
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test src/commands/up.test.ts`
Expected: PASS

Then run the full suite:

Run: `bun test`
Expected: Some old tests may fail because `runUp` signature changed (Runner → Context). Those will be fixed in Task 9.

**Step 5: Commit**

```bash
git add src/resources/index.ts src/commands/up.ts src/commands/up.test.ts
git commit -m "feat: wire resource registry into up command"
```

---

### Task 8: Update CLI entry points, down.ts, and custom function signatures

Custom functions (plugins, services, networks, apps) still take `Runner`. Update them to `Context` first — this unblocks Tasks 9+ which pass `ctx` directly.

**Files:**
- Modify: `src/index.ts`
- Modify: `src/commands/down.ts`
- Modify: `src/modules/plugins.ts` (Runner → Context)
- Modify: `src/modules/services.ts` (Runner → Context)
- Modify: `src/modules/network.ts` (Runner → Context, for ensureNetworks/exportNetworks)
- Modify: `src/modules/apps.ts` (Runner → Context, for exportApps)

**Step 1: Read the current index.ts to understand CLI wiring**

Read `src/index.ts` to see how Runner is created and passed to commands.

**Step 2: Update custom function signatures (Runner → Context)**

This is mechanical — replace `runner: Runner` with `ctx: Context`, then replace `runner.query(` → `ctx.query(`, `runner.run(` → `ctx.run(`, `runner.check(` → `ctx.check(` in each file.

For `src/modules/plugins.ts`:
```typescript
import type { Context } from '../core/context.js'
// Change: runner: Runner → ctx: Context
export async function ensurePlugins(
  ctx: Context,
  plugins: Record<string, PluginConfig>
): Promise<void> {
  const listOutput = await ctx.query('plugin:list')
  // ... rest unchanged, just s/runner./ctx./g
}
```

For `src/modules/services.ts` — same pattern for all exported functions:
```typescript
export async function ensureServices(ctx: Context, services: Record<string, ServiceConfig>): Promise<void> { ... }
export async function ensureServiceBackups(ctx: Context, services: Record<string, ServiceConfig>): Promise<void> { ... }
export async function ensureAppLinks(ctx: Context, app: string, desiredLinks: string[], allServices: Record<string, ServiceConfig>): Promise<void> { ... }
export async function destroyAppLinks(ctx: Context, app: string, links: string[], allServices: Record<string, ServiceConfig>): Promise<void> { ... }
export async function destroyServices(ctx: Context, services: Record<string, ServiceConfig>): Promise<void> { ... }
export async function exportServices(ctx: Context): Promise<Record<string, ServiceConfig>> { ... }
export async function exportAppLinks(ctx: Context, app: string, services: Record<string, ServiceConfig>): Promise<string[]> { ... }
```

For `src/modules/network.ts` (ensureNetworks, exportNetworks) and `src/modules/apps.ts` (exportApps) — same mechanical change.

Update corresponding test files to pass Context instead of Runner where tests mock `runner.query`/`runner.run` etc.

**Step 3: Update index.ts**

```typescript
import { createContext } from './core/context.js'
// ...
const runner = createRunner({ host: process.env.DOKKU_HOST, dryRun: opts.dryRun })
const ctx = createContext(runner)
await runUp(ctx, config, appFilter)
// ... same for runExport, runDiff, runDown
await ctx.close()
```

**Step 4: Update down.ts**

```typescript
// src/commands/down.ts
import type { Context } from '../core/context.js'
import type { Config } from '../core/schema.js'
import { reconcile } from '../core/reconcile.js'
import { Apps } from '../resources/lifecycle.js'
import { destroyAppLinks, destroyServices } from '../modules/services.js'
import { logAction, logDone, logSkip } from '../core/logger.js'

export interface DownOptions {
  force: boolean
}

export async function runDown(
  ctx: Context,
  config: Config,
  appFilter: string[],
  opts: DownOptions
): Promise<void> {
  const apps = appFilter.length > 0
    ? appFilter
    : Object.keys(config.apps)

  for (const app of apps) {
    const appConfig = config.apps[app]
    if (!appConfig) continue

    if (config.services && appConfig.links) {
      await destroyAppLinks(ctx, app, appConfig.links, config.services)
    }

    await reconcile(Apps, ctx, app, false)
  }

  if (config.services) {
    await destroyServices(ctx, config.services)
  }

  if (config.networks) {
    for (const net of config.networks) {
      logAction('network', `Destroying ${net}`)
      const exists = await ctx.check('network:exists', net)
      if (!exists) { logSkip(); continue }
      await ctx.run('network:destroy', net, '--force')
      logDone()
    }
  }
}
```

**Step 5: Run full test suite**

Run: `bun test`
Expected: PASS (all tests)

**Step 6: Commit**

```bash
git add src/index.ts src/commands/down.ts src/modules/plugins.ts src/modules/services.ts src/modules/network.ts src/modules/apps.ts
git commit -m "feat: unify on Context everywhere, remove Runner passthrough"
```

---

### Task 9: Rewrite export.ts and diff.ts using resources

Now that all functions take Context, rewrite export and diff to use the resource registry.

**Files:**
- Modify: `src/commands/export.ts`
- Modify: `src/commands/diff.ts`
- Create: `src/commands/export.test.ts`

**Step 1: Write failing test for export**

```typescript
// src/commands/export.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createRunner } from '../core/dokku.js'
import { createContext } from '../core/context.js'
import { runExport } from './export.js'

describe('runExport', () => {
  it('reads all resources for an app and assembles config', async () => {
    const runner = createRunner({ dryRun: false })
    runner.query = vi.fn().mockResolvedValue('')
    runner.check = vi.fn().mockResolvedValue(true)
    runner.run = vi.fn()
    const ctx = createContext(runner)

    // Mock apps list
    ;(runner.query as any)
      .mockResolvedValueOnce('0.30.0')  // version
      .mockResolvedValueOnce('=====> My Apps\nmyapp')  // apps:list

    const config = await runExport(ctx, {})
    expect(config.apps).toHaveProperty('myapp')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test src/commands/export.test.ts`
Expected: FAIL (export.ts still takes Runner)

**Step 3: Rewrite export.ts**

```typescript
// src/commands/export.ts
import type { Context } from '../core/context.js'
import type { Config } from '../core/schema.js'
import { ALL_APP_RESOURCES } from '../resources/index.js'
import { exportApps } from '../modules/apps.js'
import { exportServices, exportAppLinks } from '../modules/services.js'
import { exportNetworks } from '../modules/network.js'

export interface ExportOptions {
  appFilter?: string[]
}

export async function runExport(ctx: Context, opts: ExportOptions): Promise<Config> {
  const config: Config = { apps: {} }

  const versionOutput = await ctx.query('version')
  const versionMatch = versionOutput.match(/(\d+\.\d+\.\d+)/)
  if (versionMatch) config.dokku = { version: versionMatch[1] }

  const apps = opts.appFilter?.length ? opts.appFilter : await exportApps(ctx)

  const networks = await exportNetworks(ctx)
  if (networks.length > 0) config.networks = networks

  const services = await exportServices(ctx)
  if (Object.keys(services).length > 0) config.services = services

  for (const app of apps) {
    const appConfig: Config['apps'][string] = {}

    // Read each resource and populate if non-empty
    for (const resource of ALL_APP_RESOURCES) {
      if (resource.key.startsWith('_')) continue  // skip internal keys like _app
      const value = await resource.read(ctx, app)
      if (value !== undefined && value !== null && value !== '' &&
          !(Array.isArray(value) && value.length === 0) &&
          !(typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)) {
        (appConfig as any)[resource.key] = value
      }
    }

    // Links (custom read)
    if (Object.keys(services).length > 0) {
      const links = await exportAppLinks(ctx, app, services)
      if (links.length > 0) appConfig.links = links
    }

    config.apps[app] = appConfig
  }

  return config
}
```

**Step 4: Rewrite diff.ts**

```typescript
// src/commands/diff.ts
import type { Context } from '../core/context.js'
import type { Config, AppConfig } from '../core/schema.js'
import { computeChange } from '../core/change.js'
import { ALL_APP_RESOURCES } from '../resources/index.js'
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

export async function computeDiff(ctx: Context, config: Config): Promise<DiffResult> {
  const result: DiffResult = { apps: {}, services: {}, inSync: true }

  for (const [app, appConfig] of Object.entries(config.apps)) {
    const appDiff: AppDiff = {}

    for (const resource of ALL_APP_RESOURCES) {
      if (resource.key.startsWith('_')) continue
      const desired = (appConfig as any)[resource.key]
      if (desired === undefined) continue

      const current = await resource.read(ctx, app)
      const change = computeChange(current, desired)

      if (!change.changed) {
        appDiff[resource.key] = { status: 'in-sync', desired, current }
      } else if (current === null || current === undefined ||
                 (Array.isArray(current) && current.length === 0) ||
                 (typeof current === 'object' && Object.keys(current).length === 0)) {
        appDiff[resource.key] = { status: 'missing', desired, current }
        result.inSync = false
      } else {
        appDiff[resource.key] = { status: 'changed', desired, current }
        result.inSync = false
      }
    }

    result.apps[app] = appDiff
  }

  for (const [svc, svcConfig] of Object.entries(config.services ?? {})) {
    const exists = await ctx.check(`${svcConfig.plugin}:exists`, svc)
    result.services[svc] = { status: exists ? 'in-sync' : 'missing' }
    if (!exists) result.inSync = false
  }

  return result
}

// formatSummary and formatVerbose stay defined in this file unchanged — they work on DiffResult
// (copy them from the existing diff.ts into this rewritten version)
```

Note: `formatSummary` and `formatVerbose` stay defined in the same file (do NOT re-export from themselves). They operate on `DiffResult` which doesn't change.

**Step 5: Run tests**

Run: `bun test`
Expected: PASS (all tests)

**Step 6: Commit**

```bash
git add src/commands/export.ts src/commands/diff.ts src/commands/export.test.ts
git commit -m "feat: rewrite export and diff commands using resource registry"
```

---

### Task 10: Remove old module files incrementally

Delete old modules in groups, verifying after each group that nothing breaks. Keep modules that still have custom logic (plugins.ts, services.ts, apps.ts for exportApps, network.ts for ensureNetworks/exportNetworks).

**Step 1: Remove property-based modules (replaced by Task 4)**

```bash
rm src/modules/nginx.ts src/modules/nginx.test.ts
rm src/modules/logs.ts
rm src/modules/registry.ts
rm src/modules/scheduler.ts src/modules/scheduler.test.ts
```

Run: `bun test`
Expected: PASS

```bash
git add -A
git commit -m "refactor: remove old property modules (nginx, logs, registry, scheduler)"
```

**Step 2: Remove list-based modules (replaced by Task 5)**

```bash
rm src/modules/ports.ts src/modules/ports.test.ts
rm src/modules/domains.ts src/modules/domains.test.ts
rm src/modules/storage.ts src/modules/storage.test.ts
```

Run: `bun test`
Expected: PASS

```bash
git add -A
git commit -m "refactor: remove old list modules (ports, domains, storage)"
```

**Step 3: Remove remaining modules (replaced by Task 6)**

```bash
rm src/modules/proxy.ts src/modules/proxy.test.ts
rm src/modules/certs.ts src/modules/certs.test.ts
rm src/modules/config.ts src/modules/config.test.ts
rm src/modules/docker-options.ts
rm src/modules/builder.ts
rm src/modules/git.ts
rm src/modules/checks.ts src/modules/checks.test.ts
```

Run: `bun test`
Expected: PASS

```bash
git add -A
git commit -m "refactor: remove old toggle/lifecycle/config/build modules"
```

**Step 4: Verify no remaining imports of deleted modules**

Run: `grep -r "from '../modules/" src/commands/ src/resources/`
Expected: only `plugins.js`, `services.js`, `apps.js`, `network.js` (for ensureNetworks/exportNetworks)

---

### Task 11: Verify end-to-end with dry-run

Final verification that everything works together.

**Step 1: Run the tool in dry-run mode against a fixture**

```bash
./bin/dokku-compose up --dry-run --config src/tests/fixtures/full.yml
```

Expected: Should print the list of commands that would be run, no errors.

**Step 2: Run the full test suite one final time**

Run: `bun test`
Expected: PASS (all tests)

**Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "test: verify end-to-end resource reconciler with dry-run"
```
