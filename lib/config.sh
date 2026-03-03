# lib/config.sh — Environment variable management
# Dokku docs: https://dokku.com/docs/configuration/environment-variables/
# Commands: config:*

#!/usr/bin/env bash
# Dokku environment variable management

# Default prefix for env var convergence
DOKKU_COMPOSE_ENV_PREFIX_DEFAULT="APP_"

# Resolve the effective env_prefix for an app.
# Priority: per-app env_prefix > dokku.env_prefix > default "APP_"
# Returns empty string if prefix is disabled (false).
_resolve_env_prefix() {
    local app="${1:-}"

    # Per-app override
    if [[ -n "$app" ]] && yaml_app_key_exists "$app" "env_prefix"; then
        local app_prefix
        app_prefix=$(yq eval ".apps.${app}.env_prefix" "$DOKKU_COMPOSE_FILE")
        if [[ "$app_prefix" == "false" ]]; then
            echo ""
            return 0
        fi
        echo "$app_prefix"
        return 0
    fi

    # Global override
    if yaml_has ".dokku.env_prefix"; then
        local global_prefix
        global_prefix=$(yq eval ".dokku.env_prefix" "$DOKKU_COMPOSE_FILE")
        if [[ "$global_prefix" == "false" ]]; then
            echo ""
            return 0
        fi
        echo "$global_prefix"
        return 0
    fi

    # Default
    echo "$DOKKU_COMPOSE_ENV_PREFIX_DEFAULT"
}

# Unset orphaned env vars matching the prefix.
# Usage: _converge_env_vars <prefix> <declared_keys> [--global | <app>]
_converge_env_vars() {
    local prefix="$1" declared_keys="$2"
    shift 2

    [[ -z "$prefix" ]] && return 0

    # Build target args (either "--global" or "<app>")
    local target=("$@")

    # Get current keys from Dokku
    local current_keys
    current_keys=$(dokku_cmd config:keys "${target[@]}" 2>/dev/null || true)
    [[ -z "$current_keys" ]] && return 0

    # Find orphaned keys: match prefix, not in declared keys
    local orphaned=()
    while IFS= read -r key; do
        [[ -z "$key" ]] && continue
        # Must match prefix
        [[ "$key" != "${prefix}"* ]] && continue
        # Must not be in declared keys
        local found=false
        while IFS= read -r dk; do
            if [[ "$key" == "$dk" ]]; then
                found=true
                break
            fi
        done <<< "$declared_keys"
        if [[ "$found" == "false" ]]; then
            orphaned+=("$key")
        fi
    done <<< "$current_keys"

    if [[ ${#orphaned[@]} -gt 0 ]]; then
        local context="${target[*]}"
        [[ "$context" == "--global" ]] && context="global"
        log_action "$context" "Unsetting ${#orphaned[@]} orphaned env var(s)"
        dokku_cmd config:unset --no-restart "${target[@]}" "${orphaned[@]}"
        log_done
    fi
}

ensure_app_config() {
    local app="$1"

    yaml_app_key_exists "$app" "env" || return 0

    local raw
    raw=$(yq eval ".apps.${app}.env" "$DOKKU_COMPOSE_FILE")

    # env: false — clear all env vars
    if [[ "$raw" == "false" ]]; then
        log_action "$app" "Clearing all env vars"
        dokku_cmd config:clear --no-restart "$app"
        log_done
        return 0
    fi

    # Build KEY=VALUE pairs
    local keys
    keys=$(yaml_app_map_keys "$app" ".env")

    local env_pairs=()
    local declared_keys=""
    while IFS= read -r key; do
        [[ -z "$key" ]] && continue
        local value
        value=$(yaml_app_map_get "$app" ".env" "$key")
        value=$(resolve_env_vars "$value")
        env_pairs+=("${key}=${value}")
        declared_keys+="${key}"$'\n'
    done <<< "$keys"

    # Set env vars (if any)
    if [[ ${#env_pairs[@]} -gt 0 ]]; then
        log_action "$app" "Setting ${#env_pairs[@]} env var(s)"
        dokku_cmd config:set --no-restart "$app" "${env_pairs[@]}"
        log_done
    fi

    # Converge: unset orphaned prefixed vars
    local prefix
    prefix=$(_resolve_env_prefix "$app")
    _converge_env_vars "$prefix" "$declared_keys" "$app"
}

ensure_global_config() {
    yaml_has ".dokku.env" || return 0

    local raw
    raw=$(yq eval ".dokku.env" "$DOKKU_COMPOSE_FILE")

    # env: false — clear all global env vars
    if [[ "$raw" == "false" ]]; then
        log_action "global" "Clearing all global env vars"
        dokku_cmd config:clear --global --no-restart
        log_done
        return 0
    fi

    # Build KEY=VALUE pairs from dokku.env map
    local keys
    keys=$(yq eval '.dokku.env | keys | .[]' "$DOKKU_COMPOSE_FILE" 2>/dev/null || true)

    local env_pairs=()
    local declared_keys=""
    while IFS= read -r key; do
        [[ -z "$key" ]] && continue
        local value
        value=$(yq eval ".dokku.env.${key} // \"\"" "$DOKKU_COMPOSE_FILE")
        value=$(resolve_env_vars "$value")
        env_pairs+=("${key}=${value}")
        declared_keys+="${key}"$'\n'
    done <<< "$keys"

    # Set env vars (if any)
    if [[ ${#env_pairs[@]} -gt 0 ]]; then
        log_action "global" "Setting ${#env_pairs[@]} global env var(s)"
        dokku_cmd config:set --global --no-restart "${env_pairs[@]}"
        log_done
    fi

    # Converge: unset orphaned prefixed vars
    local prefix
    prefix=$(_resolve_env_prefix)
    _converge_env_vars "$prefix" "$declared_keys" "--global"
}
