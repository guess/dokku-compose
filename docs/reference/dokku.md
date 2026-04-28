# Dokku Version

Dokku docs: https://dokku.com/docs/getting-started/upgrading/

Module: `src/modules/version.ts`

## YAML Keys

### Pinned Version (`dokku.version`)

Declare the minimum Dokku server version your config requires. On `up` and
`diff`, dokku-compose queries the server with `dokku version` and warns if
the server is older than the pinned value. The check is opt-in — if the key
is absent, no check runs.

The value is interpreted as a **minimum**, not an exact match: a server
running a newer version than pinned is silent. Pre-release suffixes
(`-rc1`, `-beta`) on the server output are tolerated.

The `export` command writes the running server's version into this field
automatically, so round-tripping `export` → edit → `up` produces a useful
floor without manual effort.

```yaml
dokku:
  version: "0.37.9"          # warn if server is < 0.37.9
```

| Value | Behavior |
|-------|----------|
| `"X.Y.Z"` | `dokku version` (query)<br>warn if server version `< X.Y.Z` |
| absent | no action |

If the server's `dokku version` output cannot be parsed as `X.Y.Z`,
dokku-compose raises an error rather than continuing silently — that
indicates either the runner is talking to something that isn't Dokku, or
Dokku has changed its output format.
