# Git

Dokku docs: https://dokku.com/docs/deployment/methods/git/
Module: `src/resources/git.ts`

Configure how Dokku handles an app's git repository. The keys use underscores in YAML and map to the hyphenated `git:set` keys.

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
| absent | the top-level `git:` is used (below); with neither, no action |

Any other key is rejected by `validate`. In particular `archive_max_files` and `archive_max_size` are rejected: Dokku reads them only from the global setting, which dokku-compose does not manage (run `dokku git:set --global archive-max-files <n>` yourself).

## `git` (top-level)

A default for every app. It is not applied with `--global`: `up` copies it onto each app that has no `git:` of its own and reconciles it as if it were written there. An app with its own `git:` block uses only that block; the two are not merged. `diff` compares an app against the same effective block. The same keys are valid.

```yaml
git:
  deploy_branch: main          # git:set <app> deploy-branch main, for each app without its own git:

apps:
  myapp: {}                    # uses the top-level git:
  other:
    git:
      keep_git_dir: true       # own block: the top-level deploy_branch is not applied here
```

| Value | Dokku command |
|-------|---------------|
| map of the keys above | same as per app, run for each app without its own `git:` |
| absent | no action |

## Removal

`diff` shows a property set on the server but absent from the effective `git:` block as a red `-` and counts it as drift. Only `keep-git-dir` can be a removal. `deploy-branch`, `source-image` and `rev-env-var` are never removals, because Dokku writes them itself (on push and `git:sync`, on `git:from-image`, and with a default of `GIT_REV`); they are compared only when the file declares them.

`up` leaves a removed `keep-git-dir` on the server and counts it among the leftovers it reports. `up --prune` resets it with `dokku git:set <app> keep-git-dir` (no value), for an app with its own `git:` block, for an app that takes the top-level `git:` default, and for an app whose `git:` block is gone. `--prune` never resets `deploy-branch`, `source-image` or `rev-env-var`.
