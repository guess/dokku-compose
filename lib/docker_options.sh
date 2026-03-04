# lib/docker_options.sh — Docker container options
# Dokku docs: https://dokku.com/docs/advanced-usage/docker-options/
# Commands: docker-options:*

#!/usr/bin/env bash
# Dokku docker container options

ensure_app_docker_options() {
    local app="$1"

    yaml_app_has "$app" ".docker_options" || return 0

    local phase
    for phase in build deploy run; do
        yaml_app_has "$app" ".docker_options.$phase" || continue

        log_action "$app" "Setting docker options ($phase)"
        dokku_cmd docker-options:clear "$app" "$phase"

        while IFS= read -r option; do
            [[ -z "$option" ]] && continue
            dokku_cmd docker-options:add "$app" "$phase" "$option"
        done <<< "$(yaml_app_list "$app" ".docker_options.${phase}[]")"
        log_done
    done
}
