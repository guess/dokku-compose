# Zero-Downtime Checks

Dokku docs: https://dokku.com/docs/deployment/zero-downtime-deploys/

Module: `src/resources/checks.ts`

## YAML Keys

### Check Properties (`apps.<app>.checks.<property>`)

Set zero-downtime check properties per app. `up` reads `checks:report <app>` first and runs only the calls whose state differs, so a box that already matches gets no `checks:*` command and `diff` shows any difference as drift. Dokku 0.38.31's `checks:set` accepts one property, `wait-to-retire`, so it is the only key besides `disabled` and `skipped` that `validate` accepts; any other key is rejected.

```yaml
apps:
  api:
    checks:
      wait-to-retire: 60
```

| Value | Dokku Commands |
|-------|----------------|
| `<property>: <value>` | `checks:report <app>` (check)<br>`checks:set <app> <property> <value>` (if changed) |
| absent | no action |

### Disable All Checks (`apps.<app>.checks: false`)

Disable zero-downtime checks entirely for the app. This causes downtime during deploys — old containers stop before new ones start.

```yaml
apps:
  api:
    checks: false                     # disable all checks
```

| Value | Dokku Commands |
|-------|----------------|
| `false` | `checks:report <app>` (check)<br>`checks:disable <app>` (if not already `_all_`) |
| absent | no action |

### Disable Per Process Type (`apps.<app>.checks.disabled`)

Disable checks for specific process types. Types already disabled on the server are left as they are; the missing ones are passed to Dokku in one comma-separated argument. If every type is disabled (`checks:disable <app>` with no types), `up` first runs `checks:enable <app>` and then applies the declared lists.

```yaml
apps:
  api:
    checks:
      disabled:                       # disable for specific types
        - worker
        - cron
```

| Value | Dokku Commands |
|-------|----------------|
| `[list]` | `checks:report <app>` (check)<br>`checks:disable <app> <type,type>` (types not yet disabled) |
| absent | no action |

### Skip Per Process Type (`apps.<app>.checks.skipped`)

Skip health check waiting for specific process types. Zero-downtime is maintained but the default waiting period and user-defined checks are bypassed.

```yaml
apps:
  api:
    checks:
      skipped:                        # skip checks for specific types
        - cron
```

| Value | Dokku Commands |
|-------|----------------|
| `[list]` | `checks:report <app>` (check)<br>`checks:skip <app> <type,type>` (types not yet skipped) |
| absent | no action |

### Global Wait To Retire (`checks.wait-to-retire`, top-level)

Sets Dokku's global `wait-to-retire`, used by every app without its own value. It is the only checks property Dokku accepts with `--global`, so the top-level `checks:` block takes only that key; `false`, `disabled` and `skipped` are per-app and are rejected at the top level by `validate`. `up` reads `checks:report --global --format json` and runs `checks:set --global` only when the value differs; `diff` shows it under `global`.

```yaml
checks:
  wait-to-retire: 60      # checks:set --global wait-to-retire 60
```

| Value | Dokku Commands |
|-------|----------------|
| `wait-to-retire: <seconds>` | `checks:report --global --format json` (check)<br>`checks:set --global wait-to-retire <value>` (if changed) |
| absent | no action |

The new value applies on each app's next deploy; `up` lists no restart. `export` writes the server's global value as this block. A read or `--global` command that fails aborts the whole run, as every global step does.

## Removal

A `disabled` or `skipped` list, or a `wait-to-retire` value, set on the server but absent from `apps.<app>.checks` is a removal (`checks: false` has none). `diff` shows it with a red `-` and counts it as drift, including when the whole block is gone from the file. `up` leaves it on the server and does not count it in its leftover line; `dokku-compose diff` shows it. `up --prune` removes a stale `disabled`/`skipped` list with `checks:enable <app> <type,type>`, only for types the file declares in neither list (`checks:enable` clears both states, so a declared type is left with a warning naming the command to run by hand) and `wait-to-retire` with `checks:set <app> wait-to-retire`, also for a removed block.

### Top-level

A global `wait-to-retire` set on the server but absent from a top-level `checks:` block that the file declares (for example `checks: {}`) is a removal: `diff` shows it with a red `-` under `global`, `up` leaves it, and `up --prune` resets it with `checks:set --global wait-to-retire`. A file with no top-level `checks:` block never touches the global value.
