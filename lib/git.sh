# lib/git.sh — Git deployment (stub — deployment is out of scope)
# Dokku docs: https://dokku.com/docs/deployment/methods/git/
# Commands: git:* (not implemented; see design note below)

#!/usr/bin/env bash
# Dokku git deployment
# https://dokku.com/docs/deployment/methods/git/
#
# NOTE: App deployment (git:sync, git:from-image) is intentionally
# out of scope for dokku-compose. This tool handles infrastructure
# configuration; deployment is a separate concern.
#
# To deploy after running `dokku-compose up`:
#   dokku git:sync <app> <repo-url> <branch> --build
