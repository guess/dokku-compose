# Plugins

Dokku docs: https://dokku.com/docs/advanced-usage/plugin-management/

Module: `src/modules/plugins.ts`

## YAML Keys

### Plugin Declaration (`plugins.<name>`)

Declare third-party Dokku plugins to install. Plugins are keyed by name: the key becomes the `--name` argument to `plugin:install`, so the installed plugin name always matches the YAML key. `plugin:list --format json` is read once per `up` and `diff`.

```yaml
plugins:
  postgres:                                           # plugin name
    url: https://github.com/dokku/dokku-postgres.git # required
    version: "1.41.0"                                # optional: pin (a leading "v" is ignored when comparing)

  redis:
    url: https://github.com/dokku/dokku-redis.git    # no version: installed if missing, otherwise left alone
```

| State | `up` | Dokku Command |
|-------|------|---------------|
| Not installed, no `version` | Install | `plugin:install <url> --name <name>` |
| Not installed, `version` set | Install at the pin | `plugin:install <url> --committish <version> --name <name>` |
| Installed, same version | No action | none |
| Installed, older than `version` | Update | `plugin:update <name> <version>` |
| Installed, newer than `version` | Warn, no change (never downgrades) | none |
| Installed, version cannot be compared | Warn, no change | none |
| Installed, no `version` | No action | none |

`diff` lists a missing plugin, an older one and a newer one as drift, and an uncomparable one as unknown.

**`url`** (required) is the Git URL of the plugin repository. It must be a full URL (`https://`, `ssh://`); `validate` rejects the `git@host:path` form. With `plugins:` absent, `up` and `diff` do nothing for plugins.

**`version`** (optional) pins the plugin. Updates are forward only: dokku-compose never downgrades, so lowering a pin does nothing to a running box. Versions are compared as `major.minor.patch` numbers after removing a leading `v`; `1.2` never equals `1.2.0`. A pin of 7 to 40 hex characters is treated as a commit and compared with the start of the installed plugin's commit (`plugin:list --format json` `committish`); equal means in sync. Any other pin that does not compare is shown as unknown in `diff` (it does not make `diff` exit non-zero) and is never updated. A plugin that is installed but reports no version counts as installed when `version` is not set; with a pin that does not match its commit it is shown as unknown.

`plugin:list` reports the version in the plugin's `plugin.toml`, not the git commit. A matching pin therefore means the same version string, not necessarily the same commit. Plugins are never uninstalled.

Linking postgres and redis services to apps is documented in [links](links.md).
