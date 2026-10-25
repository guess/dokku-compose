# Docker Auth

Dokku docs: https://dokku.com/docs/advanced-usage/registry-management/

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

On each `up` run, dokku-compose first asks `dokku registry:auth-status --global --password-stdin <server> <username>` (Dokku >= 0.38.29), with the password on stdin, whether the stored login matches, password included:

| Exit | Meaning | `up` |
|:-:|---|---|
| 0 | the login matches | skips it |
| 1 | no login for the server | logs in |
| 2 | a different login is stored | logs in |
| 4 | a login is stored but its secret is unreadable (credential helper) | logs in |
| 3 | invalid arguments | stops with an error |

On a box whose Docker config keeps credentials in a credential helper, `registry:auth-status` cannot read the stored secret and exits 4 every time: `up` logs in on every run and `diff` never reports that server in sync.

It logs in with `dokku registry:login --global --password-stdin <server> <username>`, again with the password on stdin, so a password never appears on a command line. Rotating a password is just an `up` away. `diff` lists a server whose login is missing or differs under `global / docker_auth`, never the password.

| Field | Required | Description |
|-------|----------|-------------|
| `username` | yes | Registry username. For GHCR, the GitHub user the PAT is scoped to. |
| `password` | yes | Registry password or PAT. Use `${VAR}` interpolation and an `op://` reference rather than committing the value. |

With `docker_auth:` absent, `up` and `diff` do nothing for registry logins, and `--prune` logs out nothing.

## Distinct from `apps.<app>.registry`

This top-level `docker_auth:` is host-global pull authentication. It is **not** the same as the per-app `apps.<app>.registry:` block, which sets `registry:set <app>` properties (push destinations and image-build behavior). The two work together: `docker_auth` lets the daemon pull, `registry` configures where built images get pushed.

## Removal Semantics

Removing an entry from `docker_auth:` does not log out on a plain `up`. `up --prune` reads `registry:report --global --registry-global-auth-servers` and runs `dokku registry:logout --global <server>` for each server the file does not list (the file's server is compared the way Dokku stores it: a bare `hub.docker.com` or `docker.com`, and any `index.docker.io` URL, count as `docker.io`). `diff` shows those servers as `- <server> (not in the file)`. Logouts only run when `docker_auth:` is declared.

## Secrets

Passwords go to Dokku on stdin, so they never appear in `--dry-run` output, logs or error messages.

## Common Use Case: Private GHCR

```yaml
docker_auth:
  ghcr.io:
    username: "${GHCR_USERNAME}"
    password: "${GHCR_PAT}"
```

With an env file of 1Password references:

```
GHCR_USERNAME=op://myvault/github/user
GHCR_PAT=op://myvault/github/packages-pat
```

And `op run --env-file=myapp.env -- dokku-compose up`, the values are resolved from 1Password at apply time and never written to disk on the host.
