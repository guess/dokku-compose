# Docker Options

Dokku docs: https://dokku.com/docs/advanced-usage/docker-options/

Module: `lib/docker_options.sh`

## YAML Keys

Dokku applies deploy and run options only to containers created afterwards, so `up` lists an app whose deploy or run options changed as needing `dokku ps:restart <app>`. Build options need a rebuild instead and are not listed.

### Per-Phase Options (`docker_options.<phase>`)

Add custom Docker flags per build phase. Valid phases are `build`, `deploy`, and `run`. Each declared phase is cleared and re-populated on every `up`, providing idempotent convergence. Undeclared phases are left untouched.

```yaml
apps:
  api:
    docker_options:
      build:
        - "--no-cache"
      deploy:
        - "--shm-size 256m"
        - "-v /host/path:/container/path"
      run:
        - "--ulimit nofile=12"
```

| Value | Dokku Commands |
|-------|----------------|
| `[list]` | `docker-options:clear <app> <phase>`<br>`docker-options:add <app> <phase> <option>` (per entry) |
| absent | no action |

## Removal

`up` already removes an option on the server that is missing from a declared `docker_options` block, and `diff` shows it with a red `-`. A `docker_options` block gone from the file is left alone.

`--build-arg` options in the build phase belong to [`build.args`](builder.md), which reads and writes them as Dokku stores them (quoted words from the JSON report's `build-list`). This block's own options are still read from the text report, where options are space-joined without quoting, so a value containing ` --` or a short flag is not reliably told apart.
