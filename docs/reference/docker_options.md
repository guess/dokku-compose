# Docker Options

Dokku docs: https://dokku.com/docs/advanced-usage/docker-options/

Module: `lib/docker_options.sh`

## YAML Keys

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
