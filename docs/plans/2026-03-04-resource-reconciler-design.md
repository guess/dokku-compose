# Resource Reconciler Design

**Date:** 2026-03-04
**Status:** Proposed

## Problem

The current architecture has 16 hand-coded modules, each reimplementing read→compare→apply inline. This causes:

- Inconsistent idempotency (ports diffs properly, nginx/logs/scheduler blindly set every run)
- Three parallel "read state" implementations (ensure, export, diff) that can drift
- No query caching — repeated SSH round trips for the same data
- Adding a Dokku namespace requires a new module file + wiring into up.ts, export.ts, and diff.ts

## Design

Replace per-module ensure/destroy/export functions with a **Resource** abstraction. Each resource defines two functions — `read` and `onChange` — and all commands (up, down, diff, export, dry-run) are different traversals of the same resource definitions.

### Core Concepts

#### Context

Wraps the runner with cached queries and a command recorder.

```typescript
interface Context {
  // Queries — cached per command string
  query(...args: string[]): Promise<string>
  check(...args: string[]): Promise<boolean>

  // Mutations — always appends to commands[], also executes unless dry-run
  run(...args: string[]): void

  // Cache invalidation — drop cached entries matching a prefix.
  // Use after mutations that change queryable state (e.g. after linking
  // a service, invalidate the linked status cache).
  invalidate(...prefix: string[]): void

  // Recorded command log (serves both dry-run display and down/diff)
  commands: string[][]

  // Close the underlying SSH connection
  close(): Promise<void>
}
```

The cache is keyed by the full command string (e.g. `"nginx:report\0myapp"`). First call hits Dokku over SSH. Subsequent calls return the cached result. This eliminates redundant round trips when multiple fields come from the same report.

In dry-run mode, `run()` records but does not execute. In live mode, it does both. The onChange handler doesn't know or care which mode it's in.

#### Change Types

One generic `computeChange()` function examines the types and computes everything upfront. Uses overloads for proper type narrowing at call sites:

```typescript
// Scalar (string, number, boolean)
interface Change<T> {
  before: T
  after: T
  changed: boolean
}

// Arrays (ports, domains, storage, networks)
interface ListChange extends Change<string[]> {
  added: string[]
  removed: string[]
}

// Objects (nginx, logs, env, registry)
interface MapChange extends Change<Record<string, string>> {
  added: Record<string, string>
  removed: string[]
  modified: Record<string, string>
}

// Overloads
function computeChange(before: string[], after: string[]): ListChange
function computeChange(before: Record<string, string>, after: Record<string, string>): MapChange
function computeChange<T>(before: T, after: T): Change<T>
```

Resources don't implement their own diff. They receive a precomputed change object and pick the fields they need.

#### Resource Definition

Each resource is a plain object with a key, read function, onChange handler, and an optional `forceApply` flag:

```typescript
interface Resource<T> {
  key: string                                          // YAML path (e.g. "nginx", "ports")
  read: (ctx: Context, target: string) => Promise<T>   // target is app name or "--global"
  onChange: (ctx: Context, target: string, change: Change<T>) => void | Promise<void>
  forceApply?: boolean                                 // skip diff, always call onChange
}
```

**`forceApply`**: Some Dokku namespaces (docker-options, builder, checks) don't have a report format that can be cleanly parsed for diffing. Rather than faking a read that returns empty (which silently defeats idempotency), resources set `forceApply: true` to declare this in the type system. The reconciler skips `computeChange` and always calls `onChange`. This is honest about the trade-off.

#### Reconcile

```typescript
async function reconcile<T>(
  resource: Resource<T>,
  ctx: Context,
  target: string,
  desired: T | undefined
) {
  if (desired === undefined) return
  if (resource.forceApply) {
    await resource.onChange(ctx, target, { before: undefined, after: desired, changed: true })
    return
  }
  const before = await resource.read(ctx, target)
  const change = computeChange(before, desired)
  if (!change.changed) return
  await resource.onChange(ctx, target, change)
}
```

### Resource Definitions

#### Property-based (nginx, logs, registry, scheduler)

These all follow the same pattern — read a report, set changed properties:

```typescript
const Nginx: Resource<Record<string, string>> = {
  key: "nginx",
  read: (ctx, app) => parseReport(ctx.query("nginx:report", app), "nginx"),
  onChange: (ctx, app, { modified }: MapChange) => {
    for (const [key, value] of entries(modified))
      ctx.run("nginx:set", app, key, String(value))
    ctx.run("proxy:build-config", app)
  }
}
```

#### List-based (ports, domains, storage)

```typescript
const Ports: Resource<string[]> = {
  key: "ports",
  read: (ctx, app) => ctx.query("ports:report", app, "--ports-map").then(splitWords),
  onChange: (ctx, app, { after }: ListChange) => {
    ctx.run("ports:set", app, ...after)  // replace-all semantics
  }
}

const Domains: Resource<string[]> = {
  key: "domains",
  read: (ctx, app) => ctx.query("domains:report", app, "--domains-app-vhosts").then(splitLines),
  onChange: (ctx, app, { added, removed }: ListChange) => {
    for (const d of removed) ctx.run("domains:remove", app, d)
    for (const d of added) ctx.run("domains:add", app, d)
  }
}
```

#### Toggle (proxy)

```typescript
const Proxy: Resource<boolean> = {
  key: "proxy",
  read: (ctx, app) => ctx.query("proxy:report", app, "--proxy-enabled").then(toBool),
  onChange: (ctx, app, { after }: Change<boolean>) => {
    ctx.run(after ? "proxy:enable" : "proxy:disable", app)
  }
}
```

#### Env vars with managed keys

Config.read() returns an explicit structure separating what we manage from server state:

```typescript
interface ManagedConfig {
  managed: Record<string, string>   // keys we own (tracked by DOKKU_COMPOSE_MANAGED_KEYS)
  managedKeys: string[]             // the raw managed key list
}

const Config: Resource<Record<string, string>> = {
  key: "env",
  read: async (ctx, app) => {
    const managedRaw = await ctx.query("config:get", app, "DOKKU_COMPOSE_MANAGED_KEYS")
    const managedKeys = managedRaw.trim() ? managedRaw.trim().split(",") : []
    if (managedKeys.length === 0) return {}
    const raw = await ctx.query("config:export", app, "--format", "shell")
    const result: Record<string, string> = {}
    for (const line of raw.split("\n")) {
      const match = line.match(/^export\s+(\w+)=['"]?(.*?)['"]?$/)
      if (match && managedKeys.includes(match[1])) result[match[1]] = match[2]
    }
    return result
  },
  onChange: async (ctx, app, { added, removed, modified, after }: MapChange) => {
    if (removed.length) ctx.run("config:unset", "--no-restart", app, ...removed)
    const pairs = entries(after).map(([k, v]) => `${k}=${v}`)
    const managedValue = Object.keys(after).join(",")
    ctx.run("config:set", "--no-restart", app, ...pairs, `DOKKU_COMPOSE_MANAGED_KEYS=${managedValue}`)
  }
}
```

The two queries in `read()` are explicit and intentional: first get the managed key list, then filter the export to only managed keys. This ensures we only diff what we own. The coupling between them is visible in the same function body.

#### Lifecycle (apps)

```typescript
const Apps: Resource<boolean> = {
  key: "_app",
  read: (ctx, app) => ctx.check("apps:exists", app),
  onChange: (ctx, app, { after }: Change<boolean>) => {
    if (after) ctx.run("apps:create", app)
    else ctx.run("apps:destroy", app, "--force")
  }
}
```

#### Certs (file-based)

```typescript
const Certs: Resource<SslValue> = {
  key: "ssl",
  read: (ctx, app) => ctx.query("certs:report", app, "--ssl-enabled").then(toBool),
  onChange: (ctx, app, { before, after }) => {
    if (after === false && before) ctx.run("certs:remove", app)
    if (after && typeof after === "object")
      ctx.run("certs:add", app, after.certfile, after.keyfile)
  }
}
```

#### Force-apply resources (docker-options, builder, checks)

These namespaces lack parseable report formats. They declare `forceApply: true` so the reconciler skips diffing and always applies. The operations are safe to repeat (clear+add, idempotent set).

```typescript
const DockerOptions: Resource<DockerOpts> = {
  key: "docker_options",
  forceApply: true,
  read: async () => ({} as DockerOpts),  // unused when forceApply=true
  onChange: async (ctx, target, { after }) => {
    for (const phase of ["build", "deploy", "run"]) {
      const opts = after[phase]
      if (!opts?.length) continue
      ctx.run("docker-options:clear", target, phase)
      for (const opt of opts) ctx.run("docker-options:add", target, phase, opt)
    }
  }
}
```

### Orchestration Phases

Rather than one flat `APP_RESOURCES` array with skip-sets, `up.ts` uses explicit phases that make ordering dependencies visible:

```typescript
// Phase 1: Infrastructure (plugins, global config, networks, services)
// Phase 2: Per-app lifecycle
//   Phase 2a: Create app
//   Phase 2b: Networking (domains, links, networks, proxy, ports)
//   Phase 2c: Configuration (certs, storage, nginx, checks, logs, registry, scheduler, env)
//   Phase 2d: Build (builder, git, docker-options)

const NETWORKING_RESOURCES = [Domains, Networks, NetworkProps, Proxy, Ports]
const CONFIG_RESOURCES = [Certs, Storage, Nginx, Checks, Logs, Registry, Scheduler, Config]
const BUILD_RESOURCES = [Builder, Git, DockerOptions]
```

Links are handled explicitly between 2a and 2b because they have a cross-resource dependency on services (Phase 1).

All resource arrays are used by export and diff too — they iterate the same phases.

### Command Implementations

| Command | `read` | `computeChange` | `onChange` | `ctx.run` behavior |
|---------|--------|-----------------|------------|-------------------|
| `up` | yes | yes (unless forceApply) | yes | executes |
| `up --dry-run` | yes | yes (unless forceApply) | yes | records |
| `diff` | yes | yes | no — prints change | n/a |
| `export` | yes | no | no | n/a |
| `down` | optional | optional | yes (after=false/null) | executes |

### Summary

| Piece | Responsibility |
|-------|---------------|
| **Context** | Cached reads, run-or-record writes |
| **`computeChange()`** | Overloaded function: ListChange/MapChange/Change from before+after |
| **Resource** | `{ key, read, onChange, forceApply? }` — 5-10 lines per Dokku namespace |
| **`reconcile()`** | Generic loop: read → computeChange → onChange (or skip diff if forceApply) |
| **Phase arrays** | NETWORKING / CONFIG / BUILD — explicit ordering with visible dependencies |

Adding a new Dokku namespace: define a resource (~5 lines), add it to the appropriate phase array. All commands pick it up automatically.

### What Stays Custom

- **Plugins** — install + version-aware update doesn't fit the property model
- **Service links** — cross-resource dependency (services must exist before linking)
- **Service backups** — multi-step auth + schedule configuration
- **Top-level networks** — create lifecycle (not property-based)

These remain as standalone functions called explicitly in the orchestrator, outside the generic resource loop. All custom functions take `Context` (not `Runner`) — one calling convention everywhere. They use `ctx.query()`, `ctx.check()`, `ctx.run()` directly. Functions that read-after-write (e.g. checking link status after linking) use `ctx.invalidate()` to bust the cache for affected queries.

### Known Limitations

- **Report parser fragility**: Dokku report formats vary between plugins and versions. The `parseReport()` helper assumes "Namespace key: value" format. Needs defensive tests with real Dokku output samples from multiple plugin versions.
- **Force-apply resources**: DockerOptions, Builder, and Checks re-apply every run. This is safe (idempotent operations) but means `diff` will always show them as changed. Acceptable trade-off vs. fragile report parsing.
- **Service export**: `exportServices()` remains a stub — service state can't be reverse-engineered without knowing installed plugins.
