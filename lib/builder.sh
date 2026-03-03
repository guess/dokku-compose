#!/usr/bin/env bash
# Dokku Dockerfile builder configuration

ensure_app_builder() {
    local app="$1"

    # Dockerfile path
    local dockerfile
    dockerfile=$(yaml_app_get "$app" ".dockerfile")
    if [[ -n "$dockerfile" ]]; then
        log_action "$app" "Setting dockerfile path"
        dokku_cmd builder-dockerfile:set "$app" dockerfile-path "$dockerfile"
        log_done
    fi

    # app.json path
    local app_json
    app_json=$(yaml_app_get "$app" ".app_json")
    if [[ -n "$app_json" ]]; then
        log_action "$app" "Setting app.json path"
        dokku_cmd app-json:set "$app" appjson-path "$app_json"
        log_done
    fi

    # Build dir as APP_PATH build arg
    local build_dir
    build_dir=$(yaml_app_get "$app" ".build_dir")
    if [[ -n "$build_dir" ]]; then
        log_action "$app" "Setting build dir (APP_PATH)"
        dokku_cmd docker-options:add "$app" build "--build-arg APP_PATH=${build_dir}"
        log_done

        # Also set APP_NAME
        log_action "$app" "Setting APP_NAME build arg"
        dokku_cmd docker-options:add "$app" build "--build-arg APP_NAME=${app}"
        log_done
    fi

    # Custom build args
    if yaml_app_has "$app" ".build_args"; then
        local keys
        keys=$(yaml_app_map_keys "$app" ".build_args")
        while IFS= read -r key; do
            [[ -z "$key" ]] && continue
            local value
            value=$(yaml_app_map_get "$app" ".build_args" "$key")
            value=$(resolve_env_vars "$value")
            log_action "$app" "Setting build arg $key"
            dokku_cmd docker-options:add "$app" build "--build-arg ${key}=${value}"
            log_done
        done <<< "$keys"
    fi
}
