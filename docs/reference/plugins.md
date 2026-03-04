# Plugins

Dokku docs: https://dokku.com/docs/advanced-usage/plugin-management/

Module: `lib/plugins.sh`

## YAML Keys

### Plugin Declaration (`plugins.<name>`)

Declare third-party Dokku plugins to install. Plugins are keyed by name — the key becomes the `--name` argument to `plugin:install`, so the installed plugin name always matches the YAML key. On each `up` run, dokku-compose checks whether the plugin is installed and at the correct version, installing or updating as needed.

```yaml
plugins:
  postgres:                                           # plugin name
    url: https://github.com/dokku/dokku-postgres.git # required
    version: "1.41.0"                                # optional: pin to tag/branch/commit

  redis:
    url: https://github.com/dokku/dokku-redis.git    # no version: always skip if installed
```

| State | Action | Dokku Command |
|-------|--------|---------------|
| Not installed, no `version` | Install | `plugin:install <url> --name <name>` |
| Not installed, `version` set | Install pinned | `plugin:install <url> --committish <version> --name <name>` |
| Installed, `version` matches | Skip | — |
| Installed, `version` differs | Update | `plugin:update <name> <version>` |
| Installed, no `version` | Skip | — |

**`url`** (required) — Git URL of the plugin repository. Supports `https://`, `git://`, `ssh://`, and `.tar.gz` archives.

**`version`** (optional) — Pin the plugin to a specific git tag, branch, or commit. When the installed version differs from the declared version, `plugin:update` is called automatically. When absent, the installed plugin is left as-is.
