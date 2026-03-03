#!/usr/bin/env bash
# Dokku port management

ensure_app_ports() {
    local app="$1"

    if ! yaml_app_has "$app" ".ports"; then
        return 0
    fi

    local ports
    ports=$(yaml_app_list "$app" ".ports[]")
    [[ -z "$ports" ]] && return 0

    # Build desired port list (space-separated)
    local port_args=()
    while IFS= read -r port; do
        [[ -z "$port" ]] && continue
        port_args+=("$port")
    done <<< "$ports"

    # Check current state
    local current
    current=$(dokku_cmd ports:report "$app" --ports-map 2>/dev/null || true)

    # Compare (simple string match — ports:set is replace-all)
    local desired="${port_args[*]}"
    if [[ "$current" == "$desired" ]]; then
        log_action "$app" "Port mappings"
        log_skip
        return 0
    fi

    log_action "$app" "Setting ports: ${desired}"
    dokku_cmd ports:set "$app" "${port_args[@]}"
    log_done
}
