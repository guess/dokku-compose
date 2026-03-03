# lib/config.sh — Environment variable management
# Dokku docs: https://dokku.com/docs/configuration/environment-variables/
# Commands: config:*

#!/usr/bin/env bash
# Dokku environment variable management

ensure_app_config() {
    local app="$1"

    if ! yaml_app_has "$app" ".env"; then
        return 0
    fi

    local keys
    keys=$(yaml_app_map_keys "$app" ".env")
    [[ -z "$keys" ]] && return 0

    # Build KEY=VALUE pairs for a single config:set call
    local env_pairs=()
    while IFS= read -r key; do
        [[ -z "$key" ]] && continue
        local value
        value=$(yaml_app_map_get "$app" ".env" "$key")
        # Resolve ${VAR} references
        value=$(resolve_env_vars "$value")
        env_pairs+=("${key}=${value}")
    done <<< "$keys"

    if [[ ${#env_pairs[@]} -eq 0 ]]; then
        return 0
    fi

    log_action "$app" "Setting ${#env_pairs[@]} env var(s)"
    dokku_cmd config:set --no-restart "$app" "${env_pairs[@]}"
    log_done
}
