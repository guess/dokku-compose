#!/usr/bin/env bash
# YAML helpers wrapping yq
# https://github.com/mikefarah/yq

DOKKU_COMPOSE_FILE="${DOKKU_COMPOSE_FILE:-dokku-compose.yml}"

# Check yq is available, offer to install if not
ensure_yq() {
    if command -v yq &>/dev/null; then
        return 0
    fi

    echo "yq is required but not installed."
    echo "Install it from: https://github.com/mikefarah/yq#install"

    # Auto-install if running as root (typical on Dokku servers)
    if [[ "$(id -u)" == "0" ]]; then
        echo "Attempting auto-install..."
        local arch
        arch=$(uname -m)
        case "$arch" in
            x86_64) arch="amd64" ;;
            aarch64|arm64) arch="arm64" ;;
            *) echo "Unsupported architecture: $arch"; return 1 ;;
        esac
        local os
        os=$(uname -s | tr '[:upper:]' '[:lower:]')
        local url="https://github.com/mikefarah/yq/releases/latest/download/yq_${os}_${arch}"
        curl -sL "$url" -o /usr/local/bin/yq && chmod +x /usr/local/bin/yq
        echo "yq installed to /usr/local/bin/yq"
    else
        return 1
    fi
}

# Read a value from the config file
# Usage: yaml_get ".dokku.version"
yaml_get() {
    local path="$1"
    yq eval "$path // \"\"" "$DOKKU_COMPOSE_FILE"
}

# Read a list from the config file, one item per line
# Usage: yaml_list ".networks[]"
yaml_list() {
    local path="$1"
    yq eval "$path" "$DOKKU_COMPOSE_FILE" 2>/dev/null || true
}

# Get all app names
# Usage: yaml_app_names
yaml_app_names() {
    yq eval '.apps | keys | .[]' "$DOKKU_COMPOSE_FILE"
}

# Get a value for a specific app
# Usage: yaml_app_get "funqtion" ".dockerfile"
yaml_app_get() {
    local app="$1" path="$2"
    yq eval ".apps.${app}${path} // \"\"" "$DOKKU_COMPOSE_FILE"
}

# Get a list for a specific app
# Usage: yaml_app_list "funqtion" ".ports[]"
yaml_app_list() {
    local app="$1" path="$2"
    yq eval ".apps.${app}${path}" "$DOKKU_COMPOSE_FILE" 2>/dev/null || true
}

# Check if an app key exists and is not null
# Usage: yaml_app_has "funqtion" ".postgres"
yaml_app_has() {
    local app="$1" path="$2"
    local val
    val=$(yq eval ".apps.${app}${path}" "$DOKKU_COMPOSE_FILE" 2>/dev/null)
    [[ -n "$val" && "$val" != "null" ]]
}

# Get all keys of a map for an app
# Usage: yaml_app_map_keys "funqtion" ".env"
yaml_app_map_keys() {
    local app="$1" path="$2"
    yq eval ".apps.${app}${path} | keys | .[]" "$DOKKU_COMPOSE_FILE" 2>/dev/null || true
}

# Get a map value for an app
# Usage: yaml_app_map_get "funqtion" ".env" "APP_ENV"
yaml_app_map_get() {
    local app="$1" path="$2" key="$3"
    yq eval ".apps.${app}${path}.${key} // \"\"" "$DOKKU_COMPOSE_FILE"
}

# Check if a top-level key exists and is not null
# Usage: yaml_has ".services"
yaml_has() {
    local path="$1"
    local val
    val=$(yq eval "$path" "$DOKKU_COMPOSE_FILE" 2>/dev/null)
    [[ -n "$val" && "$val" != "null" ]]
}

# Get all service names from top-level services
# Usage: yaml_service_names
yaml_service_names() {
    yq eval '.services | keys | .[]' "$DOKKU_COMPOSE_FILE" 2>/dev/null || true
}

# Get a property of a named service
# Usage: yaml_service_get "api-postgres" ".plugin"
yaml_service_get() {
    local service="$1" path="$2"
    yq eval ".services.${service}${path} // \"\"" "$DOKKU_COMPOSE_FILE"
}

# Check if a key exists in an app's config (even if null/empty)
# Usage: yaml_app_key_exists "myapp" "links"
yaml_app_key_exists() {
    local app="$1" key="$2"
    local result
    result=$(yq eval ".apps.${app} | has(\"${key}\")" "$DOKKU_COMPOSE_FILE" 2>/dev/null)
    [[ "$result" == "true" ]]
}

# Resolve ${VAR} references in a string using the current environment
# Usage: resolve_env_vars "some ${VAR} string"
resolve_env_vars() {
    local str="$1"
    echo "$str" | envsubst
}
