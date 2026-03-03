# Apps

Dokku docs: https://dokku.com/docs/deployment/application-management/

Module: `lib/apps.sh`

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

During `up`, apps are created if they don't already exist. During `down --force`, apps are destroyed.

| Action | Dokku Command |
|--------|---------------|
| Create | `apps:create <app>` |
| Destroy | `apps:destroy <app> --force` |

### `locked`

Lock or unlock an app to prevent/allow deploys. When the key is absent, no lock state is changed.

```yaml
apps:
  api:
    locked: true    # apps:lock — prevent deploys

  staging:
    locked: false   # apps:unlock — allow deploys

  worker:
    # locked key absent — no change to lock state
```

| Value | Dokku Command |
|-------|---------------|
| `true` | `apps:lock <app>` |
| `false` | `apps:unlock <app>` |
| absent | no action |
