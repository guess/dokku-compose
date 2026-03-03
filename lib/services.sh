#!/usr/bin/env bash
# Generic Dokku service plugin management
# Replaces dedicated postgres.sh and redis.sh with a single handler
# that works with any official Dokku service plugin (postgres, redis, mongo, mysql, etc.)

# Get the directory containing the compose file (for resolving script paths)
_compose_file_dir() {
    local dir
    dir=$(dirname "$DOKKU_COMPOSE_FILE")
    cd "$dir" && pwd
}

# Get list of plugin names from dokku.plugins
_service_plugin_names() {
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

ensure_app_services() {
    local app="$1"

    local plugins
    plugins=$(_service_plugin_names)
    [[ -z "$plugins" || "$plugins" == "null" ]] && return 0

    while IFS= read -r plugin; do
        [[ -z "$plugin" ]] && continue

        # Skip plugins not configured on this app
        if ! yaml_app_has "$app" ".$plugin"; then
            continue
        fi

        # Custom script plugins
        if _plugin_has_script "$plugin"; then
            log_action "$app" "Running $plugin script"
            _run_plugin_script "$plugin" "$app" "up"
            log_done
            continue
        fi

        # Generic service plugin: create + link
        local service="${app}-${plugin}"
        local svc_config
        svc_config=$(yaml_app_get "$app" ".$plugin")

        # Build create flags from per-app config
        local create_flags=()
        if [[ "$svc_config" != "true" ]]; then
            local version image
            version=$(yaml_app_get "$app" ".${plugin}.version")
            image=$(yaml_app_get "$app" ".${plugin}.image")
            [[ -n "$version" ]] && create_flags+=(-I "$version")
            [[ -n "$image" ]] && create_flags+=(-i "$image")
        fi

        # Create service if needed
        if ! dokku_cmd_check "${plugin}:exists" "$service"; then
            log_action "$app" "Creating ${plugin}${create_flags[*]:+ (${create_flags[*]})}"
            dokku_cmd "${plugin}:create" "$service" "${create_flags[@]}"
            log_done
        else
            log_action "$app" "${plugin^} service"
            log_skip
        fi

        # Link if not already linked
        if ! dokku_cmd_check "${plugin}:linked" "$service" "$app"; then
            log_action "$app" "Linking ${plugin}"
            dokku_cmd "${plugin}:link" "$service" "$app" --no-restart
            log_done
        else
            log_action "$app" "${plugin^} link"
            log_skip
        fi
    done <<< "$plugins"
}

destroy_app_services() {
    local app="$1"

    local plugins
    plugins=$(_service_plugin_names)
    [[ -z "$plugins" || "$plugins" == "null" ]] && return 0

    while IFS= read -r plugin; do
        [[ -z "$plugin" ]] && continue

        # Custom script plugins
        if _plugin_has_script "$plugin"; then
            if yaml_app_has "$app" ".$plugin"; then
                log_action "$app" "Running $plugin script (down)"
                _run_plugin_script "$plugin" "$app" "down"
                log_done
            fi
            continue
        fi

        # Generic service plugin: unlink + destroy
        local service="${app}-${plugin}"

        if ! dokku_cmd_check "${plugin}:exists" "$service"; then
            continue
        fi

        # Unlink if linked
        if dokku_cmd_check "${plugin}:linked" "$service" "$app"; then
            log_action "$app" "Unlinking ${plugin}"
            dokku_cmd "${plugin}:unlink" "$service" "$app" --no-restart
            log_done
        fi

        log_action "$app" "Destroying ${plugin}"
        dokku_cmd "${plugin}:destroy" "$service" --force
        log_done
    done <<< "$plugins"
}
