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
