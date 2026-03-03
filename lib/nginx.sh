#!/usr/bin/env bash
# Dokku nginx proxy configuration

ensure_app_nginx() {
    local app="$1"

    if ! yaml_app_has "$app" ".nginx"; then
        return 0
    fi

    local keys
    keys=$(yaml_app_map_keys "$app" ".nginx")
    [[ -z "$keys" ]] && return 0

    while IFS= read -r key; do
        [[ -z "$key" ]] && continue
        local value
        value=$(yaml_app_map_get "$app" ".nginx" "$key")

        log_action "$app" "Setting nginx $key=$value"
        dokku_cmd nginx:set "$app" "$key" "$value"
        log_done
    done <<< "$keys"
}
