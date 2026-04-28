# Docker Auth

Dokku docs: https://dokku.com/docs/deployment/registry-management/

Module: `src/modules/docker-auth.ts`

## YAML Keys

### Registry Login (`docker_auth.<server>`)

Authenticate the host docker daemon to one or more container registries. Useful when an app is deployed via `dokku git:from-image` against a private registry — without prior `docker login`, the daemon can't pull the image.

```yaml
docker_auth:
  ghcr.io:
    username: "${GHCR_USERNAME}"
    password: "${GHCR_PAT}"

  registry.example.com:
    username: "ci-user"
    password: "${REGISTRY_PASSWORD}"
```

On each `up` run, dokku-compose runs `dokku registry:login <server> <username> <password>` for every entry. Docker stores credentials in `~/.docker/config.json` and overwrites in place, so re-running is idempotent and rotation is just an `up` away.

| Field | Required | Description |
|-------|----------|-------------|
| `username` | yes | Registry username. For GHCR, the GitHub user the PAT is scoped to. |
| `password` | yes | Registry password or PAT. Use `${VAR}` interpolation and an `op://` reference rather than committing the value. |

## Distinct from `apps.<app>.registry`

This top-level `docker_auth:` is host-global pull authentication. It is **not** the same as the per-app `apps.<app>.registry:` block, which sets `registry:set <app>` properties (push destinations and image-build behavior). The two work together: `docker_auth` lets the daemon pull, `registry` configures where built images get pushed.

## Removal Semantics

Removing an entry from `docker_auth:` does **not** automatically log out — host credentials persist. To revoke, run `dokku registry:logout <server>` manually on the host. Same posture as `plugins:` (installed plugins aren't auto-removed).

## Secrets

Passwords are masked in `--dry-run` output (last 4 characters preserved). Pass `--sensitive` to dump the unmasked command list — useful for debugging, dangerous to copy/paste.

## Common Use Case: Private GHCR

```yaml
docker_auth:
  ghcr.io:
    username: "${GHCR_USERNAME}"
    password: "${GHCR_PAT}"
```

With a `qlustr.env`-style file:

```
GHCR_USERNAME=op://strates-${APP_ENV}/github/user
GHCR_PAT=op://strates-${APP_ENV}/github/packages-pat
```

And `op run --env-file=qlustr.env -- dokku-compose up`, the values are resolved from 1Password at apply time and never written to disk on the host.
