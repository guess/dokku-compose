# Redis

Dokku docs: https://dokku.com/docs/community/plugins/#official-plugins-beta

Module: `src/modules/redis.ts`

## YAML Keys

### Service Declaration (`redis.<name>`)

Declare Redis service instances. Services are created before apps during `up`, so they are ready to be linked.

```yaml
redis:
  api-cache:                           # service name
    version: "7.2-alpine"             # optional: image version

  shared-cache: {}                     # defaults: standard redis image, latest version
```

| Key | Dokku Flag |
|-----|------------|
| `version` | `redis:create <name> --image-version <version>` |
| `image` | `redis:create <name> --image <image>` |

Service creation is idempotent — if the service already exists, it is skipped.

### Export

### Changing `version` or `image` later

`up` creates a service with them and never changes an existing one: an upgrade can need a dump and downtime, so run `redis:upgrade` yourself. When the declared value differs from `redis:info <name> --format json` (`image-version`, `image`), `up` logs one warning per service with both values of each field, and `diff` shows `~ version` or `~ image` and exits non-zero. A field the file does not declare never drifts; a declared `image: redis` equals the default.

`dokku-compose export` discovers Redis services by querying `redis:list` and `redis:info` on the server. Custom images are included when they differ from the default `redis` image.
