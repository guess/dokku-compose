# Registry

Dokku docs: https://dokku.com/docs/advanced-usage/registry-management/
Module: `src/resources/properties.ts`

Configure how Dokku names and pushes an app's image. Each entry is passed to `registry:set`; only the properties `registry:set` accepts are allowed.

## `apps.<app>.registry`

Sets per-app registry properties. `up` reads `registry:report <app>` and runs `registry:set <app>` only for the entries that differ. Only `image-repo`, `image-repo-template`, `push-extra-tags`, `push-on-release` and `server` pass `validate`; any other key is rejected (`auth-servers` is report-only, a registry login rather than a property). Values are strings or booleans; a boolean is passed as `true` or `false`.

```yaml
apps:
  myapp:
    registry:
      server: "registry.example.com"            # registry:set myapp server registry.example.com
      image-repo: "example/myapp"               # registry:set myapp image-repo example/myapp
      image-repo-template: "example/{{ .AppName }}"  # registry:set myapp image-repo-template example/{{ .AppName }}
      push-on-release: true                     # registry:set myapp push-on-release true
      push-extra-tags: "stable,latest"          # registry:set myapp push-extra-tags stable,latest
```

| Value | Dokku command |
|-------|---------------|
| map of `key: value` pairs | `registry:report <app>` (check)<br>`registry:set <app> <key> <value>` for each entry that differs |
| absent | no action |

Keys that are set on the server but not in the map are left alone.

## `registry` (top-level)

Sets Dokku's global registry settings, which every app without its own value inherits. `up` reads `registry:report --global --format json` and runs `registry:set --global` only for the entries that differ; `diff` shows them under `global`. Dokku accepts four keys with `--global`: `image-repo-template`, `push-extra-tags`, `push-on-release` and `server`. `image-repo` names one app's repository, so it is rejected at the top level by `validate`, as is the report-only `auth-servers`. A global change reaches an app on its next release; `up` lists no restart for it.

```yaml
registry:
  server: "registry.example.com"                  # registry:set --global server registry.example.com
  image-repo-template: "example/{{ .AppName }}"   # registry:set --global image-repo-template example/{{ .AppName }}
  push-on-release: true                           # registry:set --global push-on-release true
  push-extra-tags: "stable"                       # registry:set --global push-extra-tags stable
```

| Value | Dokku command |
|-------|---------------|
| map of `key: value` pairs | `registry:report --global --format json` (check)<br>`registry:set --global <key> <value>` for each entry that differs |
| absent | no action |

With `push-on-release: true` globally, every app without its own `registry:` pushes its image on each release; declare it only when that is what the box should do. `export` writes the server's global values as this block. A read or `--global` command that fails aborts the whole run, as every global step does.

## Removal

A property set on the server but absent from `apps.<app>.registry` is a removal. `diff` shows it with a red `-` and counts it as drift, including when the whole block is gone from the file. Only the settable registry properties are considered, never read-only report lines. `up` leaves it on the server and, for a block the file declares, includes it in a one-line count of leftovers it noticed. `up --prune` resets it with `registry:set <app> <key>` and no value, also for a removed block.

### Top-level

A global key set on the server but absent from a top-level `registry:` block that the file declares is a removal: `diff` shows it with a red `-` under `global`, `up` leaves it, and `up --prune` resets it with `registry:set --global <key>` and no value. A file with no top-level `registry:` block never touches the global registry settings.
