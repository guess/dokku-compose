# lib/nginx.sh — Nginx proxy configuration
# Dokku docs: https://dokku.com/docs/networking/proxies/nginx/
# Commands: nginx:*

#!/usr/bin/env bash
# Dokku nginx proxy configuration

ensure_app_nginx() {
    dokku_set_properties "$1" "nginx"
}

ensure_global_nginx() {
    yaml_has ".nginx" || return 0

    local keys
    keys=$(yq eval ".nginx | keys | .[]" "$DOKKU_COMPOSE_FILE" 2>/dev/null || true)
    [[ -z "$keys" ]] && return 0

    while IFS= read -r key; do
        [[ -z "$key" ]] && continue
        local value
        value=$(yq eval ".nginx.${key} // \"\"" "$DOKKU_COMPOSE_FILE")
        log_action "global" "Setting nginx $key=$value"
        dokku_cmd "nginx:set" "--global" "$key" "$value"
        log_done
    done <<< "$keys"
}

destroy_app_nginx() {
    local app="$1"
    yaml_app_has "$app" ".nginx" || return 0

    local keys
    keys=$(yaml_app_map_keys "$app" ".nginx")
    [[ -z "$keys" ]] && return 0

    while IFS= read -r key; do
        [[ -z "$key" ]] && continue
        log_action "$app" "Clearing nginx $key"
        dokku_cmd "nginx:set" "$app" "$key"
        log_done
    done <<< "$keys"
}
