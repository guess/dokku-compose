# Git

Dokku docs: https://dokku.com/docs/deployment/methods/git/
Module: `src/resources/git.ts` (per app and top-level)

Configure how Dokku handles git repositories, per app and globally. The keys use underscores in YAML and map to the hyphenated `git:set` keys.

## `apps.<app>.git`

Sets per-app git properties. `up` reads `git:report <app>` and runs `git:set <app>` only for the entries that differ. Properties on the server that the file does not declare are left alone.

```yaml
apps:
  myapp:
    git:
      deploy_branch: main                       # git:set myapp deploy-branch main
      keep_git_dir: true                        # git:set myapp keep-git-dir true
      rev_env_var: GIT_REV                      # git:set myapp rev-env-var GIT_REV
      source_image: example.com/myapp:latest    # git:set myapp source-image example.com/myapp:latest
```

| YAML key | Dokku key | Value |
|----------|-----------|-------|
| `deploy_branch` | `deploy-branch` | string |
| `keep_git_dir` | `keep-git-dir` | string or boolean (`true` is passed as `true`) |
| `rev_env_var` | `rev-env-var` | string |
| `source_image` | `source-image` | string |

| Value | Dokku command |
|-------|---------------|
| map of the keys above | `git:report <app>` (check)<br>`git:set <app> <key> <value>` for each entry that differs |
| absent | no action; the app inherits the global git settings |

Any other key is rejected by `validate`. In particular `archive_max_files` and `archive_max_size` are rejected per app: Dokku reads them only from the global setting (see the top-level `git:` below).

An app without its own value uses the top-level `git:` through Dokku's inheritance; dokku-compose neither copies nor merges anything.

## `git` (top-level)

Sets Dokku's global git settings with `git:set --global`, which every app without its own value inherits. This replaces the earlier meaning of a top-level `git:` (a block copied onto each app without its own `git:`); see Migrating below. `up` reads `git:report --global --format json` and runs `git:set --global` only for the entries that differ; `diff` shows them under `global`.

Dokku reads four keys globally: `deploy_branch`, `keep_git_dir`, `archive_max_files` and `archive_max_size`. The two `archive_max_*` limits exist only here (Dokku ignores a per-app value), so they are declarable at the top level only. `rev_env_var` and `source_image` are per-app settings that Dokku never reads globally, so `validate` rejects them at the top level.

```yaml
git:
  deploy_branch: main            # git:set --global deploy-branch main
  keep_git_dir: true             # git:set --global keep-git-dir true
  archive_max_files: 20000       # git:set --global archive-max-files 20000
  archive_max_size: 2147483648   # git:set --global archive-max-size 2147483648

apps:
  myapp: {}                      # inherits the global git settings
  other:
    git:
      deploy_branch: release     # own value wins; the other global values still apply
```

| YAML key | Dokku key | Value |
|----------|-----------|-------|
| `deploy_branch` | `deploy-branch` | string |
| `keep_git_dir` | `keep-git-dir` | string or boolean |
| `archive_max_files` | `archive-max-files` | string or number |
| `archive_max_size` | `archive-max-size` | string or number (bytes) |

| Value | Dokku command |
|-------|---------------|
| map of the keys above | `git:report --global --format json` (check)<br>`git:set --global <key> <value>` for each entry that differs |
| absent | no action |

An app with its own `git:` block is no longer cut off from the top-level block: a key its block does not set is inherited. `export` writes the server's global values as this block. A read or `--global` command that fails aborts the whole run, as every global step does.

### Migrating from the old top-level `git:`

Before, `up` copied the top-level block onto every app without its own `git:`, writing per-app `git:set <app> ...` values. After upgrading, the same file runs `git:set --global` instead, and the per-app values the old behaviour wrote are settings on the server that the file no longer declares:

1. Run `dokku-compose diff`. It shows a red `-` under `git` for each leftover per-app `keep-git-dir`, and for each per-app `deploy-branch` that equals the top-level `deploy_branch` (a copy), and the new values under `global`.
2. Run `dokku-compose up --prune`. It sets the globals, then clears each leftover with `git:set <app> keep-git-dir` or `git:set <app> deploy-branch`, so the app inherits the global value. Dokku writes a per-app `deploy-branch` only on `git:sync` of a new app with a branch ref, or on a push when the app and the global value are both empty, so with a global value set a cleared copy does not come back.
3. A per-app `deploy-branch` that differs from the top-level one is a deliberate override and stays. `rev-env-var` and `source-image` have no global form and are never removals, so they stay as they are.
4. A file with a top-level `rev_env_var` or `source_image` (copied onto apps before) now fails `validate`: move them under the apps that need them.
5. An app that had its own `git:` block keeps its values; a key its block does not set was unset before and is now inherited from the top-level block.

## Removal

`diff` shows a property set on the server but absent from the app's `git:` block as a red `-` and counts it as drift. `keep-git-dir` can be a removal. `deploy-branch`, `source-image` and `rev-env-var` are mostly not, because Dokku writes them itself (on push and `git:sync`, on `git:from-image`, and with a default of `GIT_REV`); they are compared only when the file declares them, apart from the copied `deploy-branch` below.

A per-app `deploy-branch` is a removal in one case: the file's top-level `git:` declares `deploy_branch`, the app's own `git:` (or its absence) does not, and the app's value equals the top-level one. It is then a copy the old behaviour wrote, and the app would inherit the same value. The comparison is with the value declared in the file, not the one on the server.

`up` leaves a removed `keep-git-dir` or copied `deploy-branch` on the server and counts it among the leftovers it reports. `up --prune` resets it with `dokku git:set <app> keep-git-dir` or `dokku git:set <app> deploy-branch` (no value), for an app with its own `git:` block and for an app whose `git:` block is gone, so the app inherits the global value. `--prune` never resets `source-image` or `rev-env-var`, nor a `deploy-branch` that differs from the top-level one.

### Top-level

A global key set on the server but absent from a top-level `git:` block that the file declares is a removal: `diff` shows it with a red `-` under `global`, `up` leaves it, and `up --prune` resets it with `git:set --global <key>` and no value. Dokku writes none of the four global keys itself, so all of them can be removals. A file with no top-level `git:` block never touches the global values.
