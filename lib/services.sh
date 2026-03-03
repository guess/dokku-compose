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

# --- Per-app link management ---

ensure_app_links() {
    local app="$1"

    # Key absent = skip entirely
    if ! yaml_app_key_exists "$app" "links"; then
        return 0
    fi

    # Build desired links list
    local desired_links=""
    if yaml_app_has "$app" ".links"; then
        desired_links=$(yaml_app_list "$app" ".links[]")
    fi

    # Link desired services
    if [[ -n "$desired_links" ]]; then
        while IFS= read -r service; do
            [[ -z "$service" ]] && continue
            local plugin
            plugin=$(_service_plugin "$service")
            [[ -z "$plugin" ]] && continue

            if ! dokku_cmd_check "${plugin}:linked" "$service" "$app"; then
                log_action "$app" "Linking ${service}"
                dokku_cmd "${plugin}:link" "$service" "$app" --no-restart
                log_done
            else
                log_action "$app" "Link ${service}"
                log_skip
            fi
        done <<< "$desired_links"
    fi

    # Unlink services that are linked but not in desired list
    if ! yaml_has ".services"; then
        return 0
    fi

    local all_services
    all_services=$(yaml_service_names)
    [[ -z "$all_services" ]] && return 0

    while IFS= read -r service; do
        [[ -z "$service" ]] && continue
        local plugin
        plugin=$(_service_plugin "$service")
        [[ -z "$plugin" ]] && continue

        # Is this service currently linked to the app?
        if dokku_cmd_check "${plugin}:linked" "$service" "$app"; then
            # Is it NOT in the desired links?
            if [[ -z "$desired_links" ]] || ! echo "$desired_links" | grep -qxF "$service"; then
                log_action "$app" "Unlinking ${service}"
                dokku_cmd "${plugin}:unlink" "$service" "$app" --no-restart
                log_done
            fi
        fi
    done <<< "$all_services"
}
