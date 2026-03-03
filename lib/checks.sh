# lib/checks.sh — Zero-downtime deploy checks
# Dokku docs: https://dokku.com/docs/deployment/zero-downtime-deploys/
# Commands: checks:*

#!/usr/bin/env bash
# Dokku zero-downtime deploy checks

ensure_app_checks() {
    dokku_set_properties "$1" "checks"
}
