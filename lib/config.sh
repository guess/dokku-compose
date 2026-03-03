# lib/config.sh — Environment variable management
# Dokku docs: https://dokku.com/docs/configuration/environment-variables/
# Commands: config:*

#!/usr/bin/env bash
# Dokku environment variable management

# Default prefix for env var convergence
DOKKU_COMPOSE_ENV_PREFIX_DEFAULT="APP_"

# Resolve the effective env_prefix.
# Uses dokku.env_prefix if set, otherwise default "APP_".
_resolve_env_prefix() {
    if yaml_has ".dokku.env_prefix"; then
        yaml_get ".dokku.env_prefix"
        return 0
    fi
    echo "$DOKKU_COMPOSE_ENV_PREFIX_DEFAULT"
}

# Unset orphaned env vars matching the prefix.
# Usage: _converge_env_vars <prefix> <declared_keys_newline_separated> [--global | <app>]
_converge_env_vars() {
    local prefix="$1" declared_keys="$2"
    shift 2

    local target=("$@")

    # Get current keys from Dokku
    local current_keys
    current_keys=$(dokku_cmd config:keys "${target[@]}" 2>/dev/null || true)
    [[ -z "$current_keys" ]] && return 0

    # Build declared keys lookup set
    declare -A declared_set
    while IFS= read -r dk; do
        [[ -n "$dk" ]] && declared_set["$dk"]=1
    done <<< "$declared_keys"

    # Find orphaned keys: match prefix, not in declared keys
    local orphaned=()
    while IFS= read -r key; do
        [[ -z "$key" ]] && continue
        [[ "$key" != "${prefix}"* ]] && continue
        [[ -z "${declared_set[$key]+x}" ]] && orphaned+=("$key")
    done <<< "$current_keys"

    if [[ ${#orphaned[@]} -gt 0 ]]; then
        local context="${target[*]}"
        [[ "$context" == "--global" ]] && context="global"
        log_action "$context" "Unsetting ${#orphaned[@]} orphaned env var(s)"
        dokku_cmd config:unset --no-restart "${target[@]}" "${orphaned[@]}"
        log_done
    fi
}

# Build KEY=VALUE pairs from a YAML env map and set/converge them.
# Vars not matching the prefix are warned and skipped.
_set_and_converge_env() {
    local context="$1" keys="$2" prefix="$3"
    shift 3
    local target=("$@")

    local env_pairs=()
    local declared_keys=""
    while IFS= read -r key; do
        [[ -z "$key" ]] && continue
        # Warn and skip vars that don't match prefix
        if [[ "$key" != "${prefix}"* ]]; then
            log_warn "$context" "Skipping '$key' — does not match prefix '${prefix}'"
            continue
        fi
        local value
        value=$(_current_yaml_value_fn "$key")
        value=$(resolve_env_vars "$value")
        env_pairs+=("${key}=${value}")
        declared_keys+="${key}"$'\n'
    done <<< "$keys"

    # Set env vars (if any)
    if [[ ${#env_pairs[@]} -gt 0 ]]; then
        local label="Setting ${#env_pairs[@]} env var(s)"
        [[ "$context" == "global" ]] && label="Setting ${#env_pairs[@]} global env var(s)"
        log_action "$context" "$label"
        dokku_cmd config:set --no-restart "${target[@]}" "${env_pairs[@]}"
        log_done
    fi

    # Converge: unset orphaned prefixed vars
    _converge_env_vars "$prefix" "$declared_keys" "${target[@]}"
}

ensure_app_config() {
    local app="$1"

    yaml_app_key_exists "$app" "env" || return 0

    local prefix
    prefix=$(_resolve_env_prefix)

    local raw
    raw=$(yq eval ".apps.${app}.env" "$DOKKU_COMPOSE_FILE")

    # env: false = empty map (all prefixed vars are orphaned)
    local keys=""
    if [[ "$raw" != "false" ]]; then
        keys=$(yaml_app_map_keys "$app" ".env")
        _current_yaml_value_fn() { yaml_app_map_get "$app" ".env" "$1"; }
    fi

    _set_and_converge_env "$app" "$keys" "$prefix" "$app"

    unset -f _current_yaml_value_fn 2>/dev/null || true
}

ensure_global_config() {
    yaml_has ".env" || return 0

    local prefix
    prefix=$(_resolve_env_prefix)

    local raw
    raw=$(yq eval ".env" "$DOKKU_COMPOSE_FILE")

    # env: false = empty map (all prefixed vars are orphaned)
    local keys=""
    if [[ "$raw" != "false" ]]; then
        keys=$(yq eval '.env | keys | .[]' "$DOKKU_COMPOSE_FILE" 2>/dev/null || true)
        _current_yaml_value_fn() { yq eval ".env.${1} // \"\"" "$DOKKU_COMPOSE_FILE"; }
    fi

    _set_and_converge_env "global" "$keys" "$prefix" "--global"

    unset -f _current_yaml_value_fn 2>/dev/null || true
}
