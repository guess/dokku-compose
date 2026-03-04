# lib/logs.sh — Log management
# Dokku docs: https://dokku.com/docs/deployment/logs/
# Commands: logs:*

#!/usr/bin/env bash
# Dokku log management

ensure_app_logs() {
    dokku_set_properties "$1" "logs"
}

ensure_global_logs() {
    yaml_has ".logs" || return 0

    local keys
    keys=$(yq eval '.logs | keys | .[]' "$DOKKU_COMPOSE_FILE" 2>/dev/null || true)
    [[ -z "$keys" ]] && return 0

    while IFS= read -r key; do
        [[ -z "$key" ]] && continue
        local value
        value=$(yq eval ".logs.${key} // \"\"" "$DOKKU_COMPOSE_FILE")
        log_action "global" "Setting logs ${key}=${value}"
        dokku_cmd "logs:set" "--global" "$key" "$value"
        log_done
    done <<< "$keys"
}
