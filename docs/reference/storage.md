# Storage

Dokku docs: https://dokku.com/docs/advanced-usage/persistent-storage/

Module: `lib/storage.sh`

## YAML Keys

### Storage Mounts (`apps.<app>.storage`)

Declare persistent host-to-container bind mounts for an app. Each entry is a `host-path:container-path` string.

On each `up` run, mounts are fully converged against Dokku's current state:
- Mounts in YAML but not in Dokku → mounted
- Mounts in Dokku but not in YAML → unmounted
- Mounts present in both → skipped

```yaml
apps:
  api:
    storage:
      - "/var/lib/dokku/data/storage/api/uploads:/app/uploads"
      - "/var/lib/dokku/data/storage/api/data:/app/data"

  worker:
    # storage key absent — no changes to mounts
```

| Value | Dokku Command |
|-------|---------------|
| `[list]` | `storage:mount <app> <mount>` per new entry;<br>`storage:unmount <app> <mount>` per stale entry |
| absent | no action |

Host directories must exist before mounting. For Dockerfile deployments, create directories manually and set ownership to match the process user in your container.

On `down --force`, declared mounts are unmounted before the app is destroyed:

| Phase | Dokku Command |
|-------|---------------|
| down | `storage:unmount <app> <mount>` for each declared mount |
