# lib/checks.sh — Zero-downtime deploy checks
# Dokku docs: https://dokku.com/docs/deployment/zero-downtime-deploys/
# Commands: checks:*

#!/usr/bin/env bash
# Dokku zero-downtime deploy checks

# Reserved keys that are NOT passed to checks:set
_CHECKS_RESERVED_KEYS="disabled skipped"

_is_checks_reserved_key() {
    local key="$1"
    local reserved
    for reserved in $_CHECKS_RESERVED_KEYS; do
        [[ "$key" == "$reserved" ]] && return 0
    done
    return 1
}

ensure_app_checks() {
    local app="$1"

    yaml_app_key_exists "$app" "checks" || return 0

    local raw
    raw=$(yq eval ".apps.${app}.checks" "$DOKKU_COMPOSE_FILE")

    # checks: false — disable all checks
    if [[ "$raw" == "false" ]]; then
        local current_disabled
        current_disabled=$(dokku_cmd checks:report "$app" --checks-disabled-list 2>/dev/null || true)
        if [[ "$current_disabled" == "_all_" ]]; then
            log_action "$app" "Checks disabled"
            log_skip
        else
            log_action "$app" "Disabling all checks"
            dokku_cmd checks:disable "$app"
            log_done
        fi
        return 0
    fi

    # checks: {map} — set properties and process-type control
    _ensure_checks_properties "$app"
    _ensure_checks_disabled "$app"
    _ensure_checks_skipped "$app"
}

_ensure_checks_properties() {
    local app="$1"

    local keys
    keys=$(yaml_app_map_keys "$app" ".checks")
    [[ -z "$keys" ]] && return 0

    while IFS= read -r key; do
        [[ -z "$key" ]] && continue
        _is_checks_reserved_key "$key" && continue

        local desired
        desired=$(yaml_app_map_get "$app" ".checks" "$key")
        local current
        current=$(dokku_cmd checks:report "$app" "--checks-${key}" 2>/dev/null || true)

        if [[ "$current" == "$desired" ]]; then
            log_action "$app" "Checks $key=$desired"
            log_skip
        else
            log_action "$app" "Setting checks $key=$desired"
            dokku_cmd checks:set "$app" "$key" "$desired"
            log_done
        fi
    done <<< "$keys"
}

_ensure_checks_disabled() {
    local app="$1"

    local disabled_raw
    disabled_raw=$(yq eval ".apps.${app}.checks.disabled" "$DOKKU_COMPOSE_FILE" 2>/dev/null)

    # Key absent or null — no action
    [[ -z "$disabled_raw" || "$disabled_raw" == "null" ]] && return 0

    # disabled: false — re-enable all
    if [[ "$disabled_raw" == "false" ]]; then
        local current_disabled
        current_disabled=$(dokku_cmd checks:report "$app" --checks-disabled-list 2>/dev/null || true)
        if [[ "$current_disabled" == "none" || -z "$current_disabled" ]]; then
            log_action "$app" "Checks disabled list"
            log_skip
        else
            log_action "$app" "Re-enabling all checks (clearing disabled)"
            dokku_cmd checks:enable "$app"
            log_done
        fi
        return 0
    fi

    # disabled: [list] — disable specified process types
    local desired_types=()
    while IFS= read -r ptype; do
        [[ -z "$ptype" ]] && continue
        desired_types+=("$ptype")
    done <<< "$(yaml_app_list "$app" ".checks.disabled[]")"

    [[ ${#desired_types[@]} -eq 0 ]] && return 0

    local current_disabled
    current_disabled=$(dokku_cmd checks:report "$app" --checks-disabled-list 2>/dev/null || true)

    local desired_csv
    desired_csv=$(IFS=,; echo "${desired_types[*]}")

    if [[ "$current_disabled" == "$desired_csv" ]]; then
        log_action "$app" "Checks disabled: $desired_csv"
        log_skip
    else
        log_action "$app" "Disabling checks for: $desired_csv"
        dokku_cmd checks:disable "$app" "$desired_csv"
        log_done
    fi
}

_ensure_checks_skipped() {
    local app="$1"

    local skipped_raw
    skipped_raw=$(yq eval ".apps.${app}.checks.skipped" "$DOKKU_COMPOSE_FILE" 2>/dev/null)

    # Key absent or null — no action
    [[ -z "$skipped_raw" || "$skipped_raw" == "null" ]] && return 0

    # skipped: false — re-enable all
    if [[ "$skipped_raw" == "false" ]]; then
        local current_skipped
        current_skipped=$(dokku_cmd checks:report "$app" --checks-skipped-list 2>/dev/null || true)
        if [[ "$current_skipped" == "none" || -z "$current_skipped" ]]; then
            log_action "$app" "Checks skipped list"
            log_skip
        else
            log_action "$app" "Re-enabling all checks (clearing skipped)"
            dokku_cmd checks:enable "$app"
            log_done
        fi
        return 0
    fi

    # skipped: [list] — skip specified process types
    local desired_types=()
    while IFS= read -r ptype; do
        [[ -z "$ptype" ]] && continue
        desired_types+=("$ptype")
    done <<< "$(yaml_app_list "$app" ".checks.skipped[]")"

    [[ ${#desired_types[@]} -eq 0 ]] && return 0

    local current_skipped
    current_skipped=$(dokku_cmd checks:report "$app" --checks-skipped-list 2>/dev/null || true)

    local desired_csv
    desired_csv=$(IFS=,; echo "${desired_types[*]}")

    if [[ "$current_skipped" == "$desired_csv" ]]; then
        log_action "$app" "Checks skipped: $desired_csv"
        log_skip
    else
        log_action "$app" "Skipping checks for: $desired_csv"
        dokku_cmd checks:skip "$app" "$desired_csv"
        log_done
    fi
}
