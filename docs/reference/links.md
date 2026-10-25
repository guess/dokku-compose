# Links

Dokku docs: https://dokku.com/docs/deployment/application-management/ (linking is done by the [postgres](https://github.com/dokku/dokku-postgres) and [redis](https://github.com/dokku/dokku-redis) plugins)
Module: `src/modules/links.ts`

## `apps.<app>.links`

Attach postgres or redis services to an app. Dokku injects the service connection URL as an environment variable when a service is linked. Service names reference entries from the top-level `postgres:` or `redis:` keys (`validate` rejects any other name). Links are reconciled only when the file declares `postgres:` or `redis:`, and only for the services declared there. Each service is read with `<plugin>:linked <service> <app>`.

```yaml
apps:
  api:
    links:                  # link these services
      - api-postgres
      - api-redis
      - shared-cache

  worker:
    links:
      - shared-cache

  other:
    links: []               # unlink all services

  bare:
    # links key absent — same as []: unlinks every declared service
```

| Value | Behavior | Dokku Commands |
|-------|----------|----------------|
| `[list]` | Link listed services, unlink any other declared service | `<plugin>:linked <service> <app>` (check)<br>`<plugin>:link <service> <app> --no-restart [--alias ...] [--env-var ...] [--querystring ...]`<br>`<plugin>:unlink <service> <app> --no-restart` |
| `[]` (empty) or absent | Unlink every declared service from the app | `<plugin>:unlink <service> <app> --no-restart` |

A link or unlink needs `dokku ps:restart <app>` (the service's connection variables are read at container start); `up` lists the app at the end.

An entry can also be a map, to choose the variable the URL lands in (a second database on one app needs this):

```yaml
apps:
  api:
    links:
      - api-postgres                  # DATABASE_URL, as before
      - service: reports-postgres
        alias: REPORTS                # REPORTS_URL
        querystring: "sslmode=require"
      - service: api-redis
        env_var: CACHE_CONN           # CACHE_CONN, no _URL suffix
```

| Key | Dokku flag | Effect |
|-----|------------|--------|
| `service` | | The service to link (required) |
| `alias` | `--alias` | Variable is `<alias>_URL` |
| `env_var` | `--env-var` | Variable is exactly this name; cannot be combined with `alias` (`validate` rejects it) |
| `querystring` | `--querystring` | Appended to the URL after `?` |

Both flags exist in dokku-postgres and dokku-redis 2.3.1 and 2.4.0. Unknown keys are rejected by `validate`. dokku-postgres refuses an alias (or env var name) whose variable is already set on the app, so when the options of a linked service change, `up` unlinks and then links it (both with `--no-restart`; the app needs a restart to pick up the new variable).

`:links` and `:app-links` print names only, so `diff` finds the link's variable in the app's env by its URL host (`dokku-<plugin>-<service>`) and compares its name and querystring with the entry; a plain entry means `DATABASE_URL` or `REDIS_URL`, or the `DOKKU_<PLUGIN>_<COLOR>_URL` name the plugin falls back to when that one is taken (a second link of the same plugin), with no querystring. A variable of the same name that points elsewhere (set by `env:` or by hand) does not count. A difference shows as `~ links:<service>` (sensitive querystring values are masked) and `up` unlinks then links it; if the link fails after the unlink, `up` warns that the app is now unlinked. A declared service that is not linked shows as `+ links:<service>`. If the env cannot be read, or no variable points at the service, `diff` prints a warning and does not count it as drift. `export` writes the object form when the variable or querystring is not the default.

## Removal

Reconciliation is declarative: removing a service from `links:` and re-running `up` unlinks it, and so does leaving `links:` out of an app. This needs no `--prune`. `diff` shows a linked service the file does not list as `-` (`links:<service>`, or a single `links` line when the app has no `links:` at all).

## Shared Services

Because services are named independently from apps, multiple apps can link to the same service instance:

```yaml
redis:
  shared-cache: {}

apps:
  api:
    links:
      - shared-cache
  worker:
    links:
      - shared-cache
```

Both `api` and `worker` receive the same Redis connection URL.
