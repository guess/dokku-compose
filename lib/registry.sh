# lib/registry.sh — Registry management
# Dokku docs: https://dokku.com/docs/advanced-usage/registry-management/
# Commands: registry:*

#!/usr/bin/env bash
# Dokku registry management

ensure_app_registry() {
    dokku_set_properties "$1" "registry"
}
