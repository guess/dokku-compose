# Apps

Dokku docs: https://dokku.com/docs/deployment/application-management/

Module: `src/resources/lifecycle.ts` (`up`), `src/modules/apps.ts` (`down`, `export`)

## YAML Keys

### App Declaration

Apps are declared under the top-level `apps:` key. Each key becomes a Dokku app name.

```yaml
apps:
  api:
    # configuration keys go here
  worker:
    # ...
```

During `up`, `apps:exists <app>` is checked first: an app that exists is skipped, a missing one is created. `down` unlinks the app's services, then destroys the app if it exists. If creating the app fails, `up` skips that app's other resources.

| Phase | Dokku Commands |
|-------|----------------|
| up | `apps:create <app>` (if missing) |
| down | `apps:destroy <app> --force` (if it exists) |

`apps:lock` / `apps:unlock` are not managed: a `locked:` key is not part of the schema and is ignored.
