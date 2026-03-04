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
  report(namespace: string, ...args: string[]): Promise<Record<string, string>>
  query(...args: string[]): Promise<string>
  check(...args: string[]): Promise<boolean>
  exportMap(namespace: string, app: string): Promise<Record<string, string>>

  // Mutations — always appends to commands[], also executes unless dry-run
  run(...args: string[]): void

  // Recorded command log (serves both dry-run display and down/diff)
  commands: string[]
}
```

The cache is keyed by the full command string (e.g. `"nginx:report myapp"`). First call hits Dokku over SSH. Subsequent calls return the cached result. This eliminates redundant round trips when multiple fields come from the same report.

In dry-run mode, `run()` records but does not execute. In live mode, it does both. The onChange handler doesn't know or care which mode it's in.

#### Change Types

One generic `computeChange()` function examines the types and computes everything upfront:

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
```

`computeChange(before, after)` detects the type and returns the appropriate variant:

- Arrays → `ListChange` with added/removed (order-insensitive set comparison)
- Objects → `MapChange` with added/removed/modified
- Scalars → `Change` with simple equality

Resources don't implement their own diff. They receive a precomputed change object and pick the fields they need.

#### Resource Definition

Each resource is a plain object with a key, read function, and onChange handler:

```typescript
interface Resource<T> {
  key: string                                          // YAML path (e.g. "nginx", "ports")
  scope: "app" | "global" | "both"
  read: (ctx: Context, target: string) => Promise<T>   // target is app name or "global"
  onChange: (ctx: Context, target: string, change: Change<T>) => void
}
```

### Resource Definitions

#### Property-based (nginx, logs, registry, checks, scheduler)

These all follow the same pattern — read a report, set changed properties:

```typescript
const Nginx: Resource<Record<string, string>> = {
  key: "nginx",
  scope: "both",
  read: (ctx, app) => ctx.report("nginx", app),
  onChange: (ctx, app, { modified }: MapChange) => {
    for (const [key, value] of entries(modified))
      ctx.run("nginx:set", app, key, String(value))
    ctx.run("proxy:build-config", app)
  }
}

// Logs, registry, checks properties, scheduler — same shape, different namespace
```

#### List-based (ports, domains, storage, networks)

```typescript
const Ports: Resource<string[]> = {
  key: "ports",
  scope: "app",
  read: (ctx, app) => ctx.query("ports:report", app, "--ports-map").then(splitWords),
  onChange: (ctx, app, { changed, after }: ListChange) => {
    if (changed) ctx.run("ports:set", app, ...after)
  }
}

const Domains: Resource<string[]> = {
  key: "domains",
  scope: "both",
  read: (ctx, app) => ctx.query("domains:report", app, "--domains-app-vhosts").then(splitLines),
  onChange: (ctx, app, { added, removed }: ListChange) => {
    for (const d of removed) ctx.run("domains:remove", app, d)
    for (const d of added) ctx.run("domains:add", app, d)
  }
}

const Storage: Resource<string[]> = {
  key: "storage",
  scope: "app",
  read: (ctx, app) => ctx.query("storage:list", app).then(splitLines),
  onChange: (ctx, app, { added, removed }: ListChange) => {
    for (const m of removed) ctx.run("storage:unmount", app, m)
    for (const m of added) ctx.run("storage:mount", app, m)
  }
}
```

#### Toggle (proxy)

```typescript
const Proxy: Resource<boolean> = {
  key: "proxy",
  scope: "app",
  read: (ctx, app) => ctx.query("proxy:report", app, "--proxy-enabled").then(toBool),
  onChange: (ctx, app, { after }: Change<boolean>) => {
    ctx.run(after ? "proxy:enable" : "proxy:disable", app)
  }
}
```

#### Map with managed keys (env vars)

```typescript
const Config: Resource<Record<string, string>> = {
  key: "env",
  scope: "both",
  read: (ctx, app) => ctx.exportMap("config", app),
  onChange: (ctx, app, { added, removed, modified }: MapChange) => {
    if (removed.length) ctx.run("config:unset", "--no-restart", app, ...removed)
    const toSet = { ...added, ...modified }
    if (Object.keys(toSet).length) {
      const pairs = entries(toSet).map(([k, v]) => `${k}=${v}`)
      ctx.run("config:set", "--no-restart", app, ...pairs)
    }
  }
}
```

Note: managed keys tracking (`DOKKU_COMPOSE_MANAGED_KEYS`) would be handled inside Config's read/onChange — read filters it out, onChange updates it alongside the set call.

#### Lifecycle (apps, services)

```typescript
const Apps: Resource<boolean> = {
  key: "_app",
  scope: "app",
  read: (ctx, app) => ctx.check("apps:exists", app),
  onChange: (ctx, app, { after }: Change<boolean>) => {
    if (after) ctx.run("apps:create", app)
    else ctx.run("apps:destroy", app, "--force")
  }
}

const Services = {
  key: "services",
  scope: "global",
  read: (ctx, name) => ctx.check(`services:exists`, name),  // plugin-specific
  onChange: (ctx, name, { before, after }) => {
    if (!before && after) {
      ctx.run(`${after.plugin}:create`, name,
        ...(after.image ? ["--image", after.image] : []),
        ...(after.version ? ["--image-version", after.version] : []))
    }
    if (before && !after) {
      ctx.run(`${before.plugin}:destroy`, name, "--force")
    }
  }
}
```

#### Certs (file-based)

```typescript
const Certs: Resource<boolean | { certfile: string, keyfile: string }> = {
  key: "ssl",
  scope: "app",
  read: (ctx, app) => ctx.query("certs:report", app, "--ssl-enabled").then(toBool),
  onChange: (ctx, app, { before, after }) => {
    if (after === false && before) ctx.run("certs:remove", app)
    if (after && typeof after === "object")
      ctx.run("certs:add", app, after.certfile, after.keyfile)
  }
}
```

### Generic Reconcile Loop

```typescript
async function reconcile<T>(
  resource: Resource<T>,
  ctx: Context,
  target: string,
  desired: T | undefined
) {
  if (desired === undefined) return
  const before = await resource.read(ctx, target)
  const change = computeChange(before, desired)
  if (!change.changed) return
  await resource.onChange(ctx, target, change)
}
```

### Resource Registry

All resources are registered in a single array with their execution order:

```typescript
const APP_RESOURCES = [
  Apps, Domains, /* Links, */ Networks, Proxy, Ports,
  Certs, Storage, Nginx, Checks, Logs, Registry,
  Scheduler, Config, Builder, DockerOptions, Git
]

const GLOBAL_RESOURCES = [Domains, Config, Logs, Nginx]
```

### Command Implementations

All commands are different traversals of the same resources:

#### up / up --dry-run

```typescript
async function runUp(ctx: Context, config: Config) {
  if (config.plugins) await ensurePlugins(ctx, config.plugins)

  for (const res of GLOBAL_RESOURCES)
    await reconcile(res, ctx, "--global", config[res.key])

  if (config.networks) await ensureNetworks(ctx, config.networks)
  if (config.services) /* reconcile services */

  for (const [name, app] of entries(config.apps))
    for (const res of APP_RESOURCES)
      await reconcile(res, ctx, name, app[res.key])
}
```

Dry-run is the same code path — the context records commands instead of executing.

#### export

```typescript
async function runExport(ctx: Context, apps: string[]) {
  const config: any = { apps: {} }
  for (const app of apps) {
    config.apps[app] = {}
    for (const res of APP_RESOURCES) {
      const value = await res.read(ctx, app)
      if (value !== undefined && value !== null)
        config.apps[app][res.key] = value
    }
  }
  return yaml.dump(config)
}
```

#### diff

```typescript
async function runDiff(ctx: Context, config: Config) {
  for (const [name, app] of entries(config.apps)) {
    for (const res of APP_RESOURCES) {
      const desired = app[res.key]
      if (desired === undefined) continue
      const before = await res.read(ctx, name)
      const change = computeChange(before, desired)
      if (change.changed) printChange(name, res.key, change)
    }
  }
}
```

#### down

```typescript
async function runDown(ctx: Context, config: Config) {
  for (const app of Object.keys(config.apps))
    await reconcile(Apps, ctx, app, false)  // after=false triggers destroy

  for (const [name, svc] of entries(config.services ?? {}))
    await reconcile(Services, ctx, name, null)

  for (const net of config.networks ?? [])
    ctx.run("network:destroy", net)
}
```

### Summary

| Piece | Responsibility |
|-------|---------------|
| **Context** | Cached reads, run-or-record writes |
| **`computeChange()`** | One function, computes ListChange/MapChange/Change from before+after |
| **Resource** | `{ key, scope, read, onChange }` — 5-10 lines per Dokku namespace |
| **`reconcile()`** | Generic 5-line loop: read → computeChange → onChange |
| **APP_RESOURCES / GLOBAL_RESOURCES** | Ordered arrays defining execution sequence |

Adding a new Dokku namespace: define a resource (~5 lines), add it to the array. All commands pick it up automatically.

### What Stays Custom

- **Plugins** — install + version-aware update doesn't fit the property model
- **Service links** — cross-resource dependency (service must exist before linking)
- **Service backups** — multi-step auth + schedule configuration
- **Builder build args** — uses docker-options under the hood

These remain as standalone functions called explicitly in the orchestrator, outside the generic resource loop.
