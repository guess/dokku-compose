# lib/builder.sh — Dockerfile builder and build argument configuration
# Dokku docs: https://dokku.com/docs/deployment/builders/builder-management/
#              https://dokku.com/docs/deployment/builders/dockerfiles/
#              https://dokku.com/docs/advanced-usage/docker-options/
#              https://dokku.com/docs/appendices/file-formats/app-json/
# Commands: builder-dockerfile:*, builder:*, docker-options:*, app-json:*

#!/usr/bin/env bash
# Dokku Dockerfile builder configuration

ensure_app_builder() {
    local app="$1"

    yaml_app_has "$app" ".build" || return 0

    # Dockerfile path
    local dockerfile
    dockerfile=$(yaml_app_get "$app" ".build.dockerfile")
    if [[ -n "$dockerfile" ]]; then
        log_action "$app" "Setting dockerfile path"
        dokku_cmd builder-dockerfile:set "$app" dockerfile-path "$dockerfile"
        log_done
    fi

    # app.json path
    local app_json
    app_json=$(yaml_app_get "$app" ".build.app_json")
    if [[ -n "$app_json" ]]; then
        log_action "$app" "Setting app.json path"
        dokku_cmd app-json:set "$app" appjson-path "$app_json"
        log_done
    fi

    # Build context directory
    local context
    context=$(yaml_app_get "$app" ".build.context")
    if [[ -n "$context" ]]; then
        log_action "$app" "Setting build context"
        dokku_cmd builder:set "$app" build-dir "$context"
        log_done
    fi

    # Build args
    if yaml_app_has "$app" ".build.args"; then
        local keys
        keys=$(yaml_app_map_keys "$app" ".build.args")
        while IFS= read -r key; do
            [[ -z "$key" ]] && continue
            local value
            value=$(yaml_app_map_get "$app" ".build.args" "$key")
            value=$(resolve_env_vars "$value")
            log_action "$app" "Setting build arg $key"
            dokku_cmd docker-options:add "$app" build "--build-arg ${key}=${value}"
            log_done
        done <<< "$keys"
    fi
}
