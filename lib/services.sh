#!/usr/bin/env bash
# Dokku service management — top-level services with per-app links

# Get the directory containing the compose file (for resolving script paths)
_compose_file_dir() {
    local dir
    dir=$(dirname "$DOKKU_COMPOSE_FILE")
    cd "$dir" && pwd
}

# Get the plugin name for a declared service
_service_plugin() {
    local service="$1"
    yaml_service_get "$service" ".plugin"
}

# --- Top-level service instance management ---

ensure_services() {
    if ! yaml_has ".services"; then
        return 0
    fi

    local services
    services=$(yaml_service_names)
    [[ -z "$services" ]] && return 0

    while IFS= read -r service; do
        [[ -z "$service" ]] && continue

        local plugin
        plugin=$(_service_plugin "$service")
        [[ -z "$plugin" ]] && continue

        # Build create flags
        local create_flags=()
        local version image
        version=$(yaml_service_get "$service" ".version")
        image=$(yaml_service_get "$service" ".image")
        [[ -n "$version" ]] && create_flags+=(-I "$version")
        [[ -n "$image" ]] && create_flags+=(-i "$image")

        if ! dokku_cmd_check "${plugin}:exists" "$service"; then
            log_action "$service" "Creating ${plugin}${create_flags[*]:+ (${create_flags[*]})}"
            dokku_cmd "${plugin}:create" "$service" "${create_flags[@]}"
            log_done
        else
            log_action "$service" "${plugin^} service"
            log_skip
        fi
    done <<< "$services"
}
