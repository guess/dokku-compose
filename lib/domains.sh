# lib/domains.sh — Domain configuration
# Dokku docs: https://dokku.com/docs/configuration/domains/
# Commands: domains:*

#!/usr/bin/env bash
# Dokku domain configuration

ensure_app_domains() {
    local app="$1"

    if ! yaml_app_has "$app" ".domains"; then
        log_action "$app" "Disabling vhosts"
        dokku_cmd domains:disable "$app"
        log_done
        return 0
    fi

    local items=()
    while IFS= read -r domain; do
        [[ -z "$domain" ]] && continue
        items+=("$domain")
    done <<< "$(yaml_app_list "$app" ".domains[]")"

    [[ ${#items[@]} -eq 0 ]] && return 0

    log_action "$app" "Setting domains: ${items[*]}"
    dokku_cmd domains:enable "$app"
    dokku_cmd domains:set "$app" "${items[@]}"
    log_done
}

destroy_app_domains() {
    local app="$1"
    log_action "$app" "Clearing domains"
    dokku_cmd domains:clear "$app"
    log_done
}
