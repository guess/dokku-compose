# Zero-Downtime Checks

Dokku docs: https://dokku.com/docs/deployment/zero-downtime-deploys/

Module: `lib/checks.sh`

## YAML Keys

### Check Properties (`apps.<app>.checks.<property>`)

Set zero-downtime check properties per app. Each key-value pair maps to `checks:set` with idempotency — the current value is queried via `checks:report` and only changed if it differs.

```yaml
apps:
  api:
    checks:
      wait-to-retire: 60
      attempts: 5
      timeout: 10
      wait: 5
```

| Value | Dokku Commands |
|-------|----------------|
| `<property>: <value>` | `checks:report <app> --checks-<property>` (check)<br>`checks:set <app> <property> <value>` (if changed) |
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
| `false` | `checks:report <app> --checks-disabled-list` (check)<br>`checks:disable <app>` (if not already `_all_`) |
| absent | no action |

### Disable Per Process Type (`apps.<app>.checks.disabled`)

Disable checks for specific process types. Set to a list of process type names, or `false` to re-enable all.

```yaml
apps:
  api:
    checks:
      disabled:                       # disable for specific types
        - worker
        - cron

  other:
    checks:
      disabled: false                 # re-enable all (clear disabled list)
```

| Value | Dokku Commands |
|-------|----------------|
| `[list]` | `checks:report <app> --checks-disabled-list` (check)<br>`checks:disable <app> <types>` (if changed) |
| `false` | `checks:report <app> --checks-disabled-list` (check)<br>`checks:enable <app>` (if any currently disabled) |
| absent | no action |

### Skip Per Process Type (`apps.<app>.checks.skipped`)

Skip health check waiting for specific process types. Zero-downtime is maintained but the default waiting period and user-defined checks are bypassed.

```yaml
apps:
  api:
    checks:
      skipped:                        # skip checks for specific types
        - cron

  other:
    checks:
      skipped: false                  # un-skip all (clear skipped list)
```

| Value | Dokku Commands |
|-------|----------------|
| `[list]` | `checks:report <app> --checks-skipped-list` (check)<br>`checks:skip <app> <types>` (if changed) |
| `false` | `checks:report <app> --checks-skipped-list` (check)<br>`checks:enable <app>` (if any currently skipped) |
| absent | no action |
