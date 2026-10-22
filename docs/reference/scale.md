# Scale and ps

Dokku docs: https://dokku.com/docs/processes/process-management/

Module: `src/resources/ps.ts`

## YAML Keys

### Process scale (`apps.<app>.scale`)

How many processes of each type the app runs. Applied with `--skip-deploy`, so `up` never restarts an app for a scale change; the count takes effect on the next deploy, and an app that has never been deployed accepts it without error.

```yaml
apps:
  chatwoot:
    scale:
      web: 1       # process type: count
      worker: 1
```

| State | Dokku Command |
|-------|---------------|
| A listed type differs from the server (or the app reports no scale yet) | `ps:scale --skip-deploy <app> <proc>=<count>...` (one command for all changed types) |
| Every listed type already matches | none |
| A type on the server is not listed | none (left as it is) |
| `scale` absent | none |

`diff` shows a differing or unset listed type; a type that is only on the server is not drift. The current scale is read from `ps:scale <app>`.

### ps properties (`apps.<app>.ps`)

Per-app process properties.

```yaml
apps:
  strates:
    ps:
      stop-timeout-seconds: 60
```

| State | Dokku Command |
|-------|---------------|
| Property differs from `ps:report` | `ps:set <app> <key> <value>` |
| Property matches | none |
| A property on the server is not listed | none (left as it is) |
| `ps` absent | none |

Current values are read from `ps:report <app>`; keys are the report labels lowercased and hyphenated without the `Ps` prefix (`Ps stop timeout seconds` is `stop-timeout-seconds`). Properties are never reset when removed from the file.
