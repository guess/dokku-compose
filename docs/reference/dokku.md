# Dokku Version

Dokku docs: https://dokku.com/docs/getting-started/upgrading/

Module: `src/modules/version.ts`

## Supported Dokku versions

dokku-compose never installs or upgrades Dokku and never pins an exact version.
It has a built-in minimum, **Dokku 0.38.29**: the first release with
`registry:auth-status`, which `docker_auth:` uses to skip a login that already
matches. Every command dokku-compose reads as JSON (`plugin:list`, `ps:scale`,
`config:export`, `ps:report`) accepts `--format json` from 0.38.22 on.

Every command that talks to a server (`up`, `diff`, `down`, `export`, `ps`)
runs `dokku version` before any other Dokku call and stops on an older server:

```
dokku-compose 0.14.0 needs Dokku >= 0.38.29; this server runs 0.37.9. Upgrade Dokku first.
```

`validate` and `init` never touch a server and are not checked.

## YAML Keys

### Minimum Version (`dokku.version`)

Declare the minimum Dokku server version your config requires. The check is
opt-in: if the key is absent, only the built-in minimum applies.

The value is a **minimum**, not an exact match. Pre-release suffixes
(`-rc1`, `-beta`) are tolerated on both the server output and the value
itself; only the `X.Y.Z` numeric part is compared. Write the value as `X.Y.Z`: `validate` accepts any string, but `up` and `diff` fail with `Cannot parse version` on one like `0.38`. `export` writes the running
server's version into this field, so `export` → edit → `up` gives a useful
floor without manual effort.

```yaml
dokku:
  version: "0.38.31"         # up stops if the server is < 0.38.31
```

| Server vs. file | `up` | `diff` |
|-----------------|------|--------|
| older | stops before changing anything: `Dokku server is vZ but the file requires >= vX. Upgrade Dokku or lower dokku.version.` | drift line, exit 1 (does not throw) |
| equal | silent | silent |
| newer | one notice, carries on | drift line, exit 1 |

A server newer than the file is drift, not an error: `diff` shows
`~ version: 0.38.31 (file) → 0.38.32 (server)` so you can update the file when
you choose. An older server is a minimum violation: `up` refuses to run and
`diff` reports the same line.

If the server's `dokku version` output cannot be parsed as `X.Y.Z`,
dokku-compose raises an error rather than continuing silently: either the
runner is talking to something that isn't Dokku, or Dokku has changed its
output format.
