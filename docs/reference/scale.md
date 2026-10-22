# Scale and ps

Dokku docs: https://dokku.com/docs/processes/process-management/

Module: `src/resources/ps.ts`

## YAML Keys

### Process scale (`apps.<app>.scale`)

How many processes of each type the app runs. Applied with `--skip-deploy`, so `up` never restarts an app for a scale change; the count takes effect on the next deploy, and an app that has never been deployed accepts it without error.

```yaml
apps:
  myapp:
    scale:
      web: 1       # process type: count
      worker: 1
```

A count may be a `${VAR}` reference: `${VAR}` always expands to a string, and `scale` coerces a numeric string (`"2"`) to an integer. A non-numeric string, a fraction or a negative count fails validation.

| State | Dokku Command |
|-------|---------------|
| A listed type differs from the server (or the app reports no scale yet) | `ps:scale --skip-deploy <app> <proc>=<count>...` (one command for all changed types) |
| Every listed type already matches | none |
| A type on the server is not listed | none (left as it is) |
| `scale` absent | none |

`diff` shows a differing or unset listed type; a type that is only on the server is not drift. The current scale is read from `ps:scale --format json <app>`.

### ps properties (`apps.<app>.ps`)

Per-app process properties.

```yaml
apps:
  myapp:
    ps:
      stop-timeout-seconds: 60
```

| State | Dokku Command |
|-------|---------------|
| Property differs from `ps:report` | `ps:set <app> <key> <value>` |
| Property matches | none |
| A property on the server is not listed | none (not shown or reset yet) |
| `ps` absent | none |

Only the seven properties `ps:set` accepts in Dokku 0.38.31 are accepted: `dockerfile-start-cmd`, `procfile-path`, `restart-policy`, `restore`, `skip-deploy`, `start-cmd` and `stop-timeout-seconds`; any other key fails validation. Current values are read from `ps:report <app> --format json`, ignoring empty values. `restore` is Dokku-managed state (it prints `true` when unset, and `ps:stop` writes `false`): a declared value is compared, but an undeclared one is never a removal, so `--prune` does not reset it.

## Removal

A `ps` property (any of the seven above) set on the server but absent from `apps.<app>.ps` is a removal. `diff` shows it with a red `-` and counts it as drift, including when the whole block is gone from the file. `up` leaves it on the server and, for a block the file declares, includes it in a one-line count of leftovers it noticed; `dokku-compose diff` gives the full list, including removed blocks. `up --prune` resets it with `ps:set <app> <key>` and no value, also for a removed block. It never changes `scale`. `ps` read-only report fields (deployed, running, status, `computed-*`, `global-*`) are never shown. A process type only on the server is never shown or touched.
