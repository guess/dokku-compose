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

# --- Script plugin helpers ---

# Get list of plugin names from dokku.plugins
_script_plugin_names() {
    yaml_get '.dokku.plugins | keys | .[]' 2>/dev/null || true
}

# Check if a plugin has a custom script defined
_plugin_has_script() {
    local plugin="$1"
    local script
    script=$(yaml_get ".dokku.plugins.${plugin}.script")
    [[ -n "$script" && "$script" != "null" ]]
}

# Get the custom script path for a plugin
_plugin_script_path() {
    local plugin="$1"
    local script
    script=$(yaml_get ".dokku.plugins.${plugin}.script")
    echo "$(_compose_file_dir)/${script}"
}

# Run a custom script for a plugin
_run_plugin_script() {
    local plugin="$1" app="$2" action="$3"

    local script_path
    script_path=$(_plugin_script_path "$plugin")

    if [[ ! -f "$script_path" ]]; then
        log_error "$app" "Custom script not found: $script_path"
        return 1
    fi

    local config
    config=$(yq eval ".apps.${app}.${plugin} | tojson" "$DOKKU_COMPOSE_FILE" 2>/dev/null || echo '{}')

    SERVICE_ACTION="$action" \
    SERVICE_APP="$app" \
    SERVICE_CONFIG="$config" \
        source "$script_path"
}

# --- Script plugin entry points ---

ensure_app_scripts() {
    local app="$1"

    local plugins
    plugins=$(_script_plugin_names)
    [[ -z "$plugins" || "$plugins" == "null" ]] && return 0

    while IFS= read -r plugin; do
        [[ -z "$plugin" ]] && continue
        _plugin_has_script "$plugin" || continue
        yaml_app_has "$app" ".$plugin" || continue

        log_action "$app" "Running $plugin script"
        _run_plugin_script "$plugin" "$app" "up"
        log_done
    done <<< "$plugins"
}

# --- Destroy functions ---

destroy_app_links() {
    local app="$1"

    if ! yaml_app_has "$app" ".links"; then
        return 0
    fi

    local links
    links=$(yaml_app_list "$app" ".links[]")
    [[ -z "$links" || "$links" == "null" ]] && return 0

    while IFS= read -r service; do
        [[ -z "$service" ]] && continue
        local plugin
        plugin=$(_service_plugin "$service")
        [[ -z "$plugin" ]] && continue

        if dokku_cmd_check "${plugin}:linked" "$service" "$app"; then
            log_action "$app" "Unlinking ${service}"
            dokku_cmd "${plugin}:unlink" "$service" "$app" --no-restart
            log_done
        fi
    done <<< "$links"
}

destroy_services() {
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

        if ! dokku_cmd_check "${plugin}:exists" "$service"; then
            continue
        fi

        # Only destroy if no apps are still linked
        local linked_apps
        linked_apps=$(dokku_cmd "${plugin}:links" "$service" 2>/dev/null || true)
        if [[ -n "$linked_apps" ]]; then
            log_action "$service" "Still linked, skipping destroy"
            log_skip
            continue
        fi

        log_action "$service" "Destroying ${plugin}"
        dokku_cmd "${plugin}:destroy" "$service" --force
        log_done
    done <<< "$services"
}

destroy_app_scripts() {
    local app="$1"

    local plugins
    plugins=$(_script_plugin_names)
    [[ -z "$plugins" || "$plugins" == "null" ]] && return 0

    while IFS= read -r plugin; do
        [[ -z "$plugin" ]] && continue
        _plugin_has_script "$plugin" || continue
        yaml_app_has "$app" ".$plugin" || continue

        log_action "$app" "Running $plugin script (down)"
        _run_plugin_script "$plugin" "$app" "down"
        log_done
    done <<< "$plugins"
}
