# lib/core.sh — Logging, colors, and dokku_cmd wrapper
# Internal utility module — no direct Dokku command namespace

#!/usr/bin/env bash
# Core utilities for dokku-compose
# Logging, colors, dokku command wrapper

set -euo pipefail

# Colors (disabled if not a terminal)
if [[ -t 1 ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    BLUE='\033[0;34m'
    NC='\033[0m' # No Color
else
    RED='' GREEN='' YELLOW='' BLUE='' NC=''
fi

# Global state
DOKKU_COMPOSE_DRY_RUN="${DOKKU_COMPOSE_DRY_RUN:-false}"
DOKKU_COMPOSE_ERRORS=0

log_action() {
    local context="$1"
    shift
    printf "${BLUE}[%-12s]${NC} %s" "$context" "$*"
}

log_done() {
    printf "... ${GREEN}done${NC}\n"
}

log_skip() {
    printf "... ${YELLOW}already configured${NC}\n"
}

log_error() {
    local context="$1"
    shift
    printf "${RED}[%-12s] ERROR: %s${NC}\n" "$context" "$*" >&2
    DOKKU_COMPOSE_ERRORS=$((DOKKU_COMPOSE_ERRORS + 1))
}

log_warn() {
    local context="$1"
    shift
    printf "${YELLOW}[%-12s] WARN: %s${NC}\n" "$context" "$*" >&2
}

# Execute a dokku command, respecting dry-run and remote modes
# Usage: dokku_cmd <command> [args...]
dokku_cmd() {
    if [[ "$DOKKU_COMPOSE_DRY_RUN" == "true" ]]; then
        echo "[dry-run] dokku $*"
        return 0
    fi

    if [[ -n "${DOKKU_HOST:-}" ]]; then
        ssh "dokku@${DOKKU_HOST}" "$@"
    else
        dokku "$@"
    fi
}

# Check if dokku_cmd succeeds silently (for :exists checks)
# Usage: dokku_cmd_check <command> [args...]
dokku_cmd_check() {
    dokku_cmd "$@" >/dev/null 2>&1
}

# --- Helper functions for common module patterns ---

# Set each key-value pair from a YAML map via <namespace>:set.
# Usage: dokku_set_properties <app> <namespace>
# Example: dokku_set_properties "myapp" "nginx"
#   Reads apps.myapp.nginx: {client-max-body-size: "15m"}
#   Calls: dokku nginx:set myapp client-max-body-size 15m
dokku_set_properties() {
    local app="$1" ns="$2"
    yaml_app_has "$app" ".$ns" || return 0

    local keys
    keys=$(yaml_app_map_keys "$app" ".$ns")
    [[ -z "$keys" ]] && return 0

    while IFS= read -r key; do
        [[ -z "$key" ]] && continue
        local value
        value=$(yaml_app_map_get "$app" ".$ns" "$key")
        log_action "$app" "Setting $ns $key=$value"
        dokku_cmd "$ns:set" "$app" "$key" "$value"
        log_done
    done <<< "$keys"
}

# Replace all list items via <namespace>:set in one call.
# Usage: dokku_set_list <app> <namespace>
# Example: dokku_set_list "myapp" "ports"
#   Reads apps.myapp.ports: ["https:443:4000"]
#   Calls: dokku ports:set myapp https:443:4000
dokku_set_list() {
    local app="$1" ns="$2"
    yaml_app_has "$app" ".$ns" || return 0

    local items=()
    while IFS= read -r item; do
        [[ -z "$item" ]] && continue
        items+=("$item")
    done <<< "$(yaml_app_list "$app" ".${ns}[]")"

    [[ ${#items[@]} -eq 0 ]] && return 0

    log_action "$app" "Setting $ns"
    dokku_cmd "$ns:set" "$app" "${items[@]}"
    log_done
}

# Set a single scalar value via <namespace>:set.
# Usage: dokku_set_property <app> <namespace> <property>
# Example: dokku_set_property "myapp" "scheduler" "selected"
#   Reads apps.myapp.scheduler: "docker-local"
#   Calls: dokku scheduler:set myapp selected docker-local
dokku_set_property() {
    local app="$1" ns="$2" prop="$3"
    yaml_app_has "$app" ".$ns" || return 0

    local value
    value=$(yaml_app_get "$app" ".$ns")
    [[ -z "$value" ]] && return 0

    log_action "$app" "Setting $ns $prop=$value"
    dokku_cmd "$ns:set" "$app" "$prop" "$value"
    log_done
}
