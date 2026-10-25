# Scheduler

Dokku docs: https://dokku.com/docs/deployment/schedulers/scheduler-management/
Module: `src/resources/properties.ts`

Choose the scheduler that deploys an app and the shell used by `dokku run` and `dokku enter`. The two settable properties are `selected` and `shell`, passed to `scheduler:set`.

## `apps.<app>.scheduler`

A string is shorthand for `{ selected: <string> }`; a map takes `selected`, `shell` or both. Any other key in the map is rejected by `validate`. `up` reads `scheduler:report <app>` and runs `scheduler:set <app>` only for the property that differs. A property the file does not declare is not compared. There is no top-level `scheduler:` key.

```yaml
apps:
  api:
    scheduler: docker-local        # scheduler:set api selected docker-local

  worker:
    scheduler:
      selected: docker-local       # scheduler:set worker selected docker-local
      shell: sh                    # scheduler:set worker shell sh

  tool:
    scheduler:
      shell: bash                  # only the shell: scheduler:set tool shell bash
```

| Value | Dokku command |
|-------|---------------|
| string | `scheduler:report <app>` (check)<br>`scheduler:set <app> selected <value>` if it differs |
| `{selected, shell}` | `scheduler:report <app>` (check)<br>`scheduler:set <app> selected <value>` if `selected` differs<br>`scheduler:set <app> shell <value>` if `shell` differs |
| absent | no action |

## Removal

A `selected` or `shell` value set on the server but not declared in the file is a removal, including when the whole `scheduler:` key is gone. `diff` shows it with a red `-` and counts it as drift. `up` leaves it on the server and, for a key the file declares, includes it in a one-line count of leftovers it noticed. `up --prune` resets it with `scheduler:set <app> selected` or `scheduler:set <app> shell` and no value, also for a removed key.
