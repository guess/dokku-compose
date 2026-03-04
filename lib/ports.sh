# lib/ports.sh — Port mapping configuration
# Dokku docs: https://dokku.com/docs/networking/port-management/
# Commands: ports:*

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

    # Build desired port list
    local port_args=()
    while IFS= read -r port; do
        [[ -z "$port" ]] && continue
        port_args+=("$port")
    done <<< "$ports"

    # Check current state
    local current
    current=$(dokku_cmd ports:report "$app" --ports-map 2>/dev/null || true)

    # Sort both for order-insensitive comparison (word-split $current intentionally)
    local desired_sorted current_sorted
    desired_sorted=$(printf '%s\n' "${port_args[@]}" | sort | tr '\n' ' ' | sed 's/ $//')
    # shellcheck disable=SC2086
    current_sorted=$(printf '%s\n' $current | sort | tr '\n' ' ' | sed 's/ $//')

    if [[ "$current_sorted" == "$desired_sorted" ]]; then
        log_action "$app" "Port mappings"
        log_skip
        return 0
    fi

    log_action "$app" "Setting ports: ${port_args[*]}"
    dokku_cmd ports:set "$app" "${port_args[@]}"
    log_done
}

destroy_app_ports() {
    local app="$1"
    log_action "$app" "Clearing ports"
    dokku_cmd ports:clear "$app"
    log_done
}
