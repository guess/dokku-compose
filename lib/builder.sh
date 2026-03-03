# lib/builder.sh — Dockerfile builder and build argument configuration
# Dokku docs: https://dokku.com/docs/deployment/builders/builder-management/
#              https://dokku.com/docs/advanced-usage/docker-options/
#              https://dokku.com/docs/appendices/file-formats/app-json/
# Commands: builder-dockerfile:*, docker-options:*, app-json:*

#!/usr/bin/env bash
# Dokku Dockerfile builder configuration

ensure_app_builder() {
    local app="$1"

    yaml_app_has "$app" ".builder" || return 0

    # Dockerfile path
    local dockerfile
    dockerfile=$(yaml_app_get "$app" ".builder.dockerfile")
    if [[ -n "$dockerfile" ]]; then
        log_action "$app" "Setting dockerfile path"
        dokku_cmd builder-dockerfile:set "$app" dockerfile-path "$dockerfile"
        log_done
    fi

    # app.json path
    local app_json
    app_json=$(yaml_app_get "$app" ".builder.app_json")
    if [[ -n "$app_json" ]]; then
        log_action "$app" "Setting app.json path"
        dokku_cmd app-json:set "$app" appjson-path "$app_json"
        log_done
    fi

    # Build dir
    local build_dir
    build_dir=$(yaml_app_get "$app" ".builder.build_dir")
    if [[ -n "$build_dir" ]]; then
        log_action "$app" "Setting build dir"
        dokku_cmd builder:set "$app" build-dir "$build_dir"
        log_done
    fi

    # Custom build args
    if yaml_app_has "$app" ".builder.build_args"; then
        local keys
        keys=$(yaml_app_map_keys "$app" ".builder.build_args")
        while IFS= read -r key; do
            [[ -z "$key" ]] && continue
            local value
            value=$(yaml_app_map_get "$app" ".builder.build_args" "$key")
            value=$(resolve_env_vars "$value")
            log_action "$app" "Setting build arg $key"
            dokku_cmd docker-options:add "$app" build "--build-arg ${key}=${value}"
            log_done
        done <<< "$keys"
    fi
}
