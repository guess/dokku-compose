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

        while IFS= read -r option; do
            [[ -z "$option" ]] && continue
            log_action "$app" "Adding docker option ($phase): $option"
            dokku_cmd docker-options:add "$app" "$phase" "$option"
            log_done
        done <<< "$(yaml_app_list "$app" ".docker_options.${phase}[]")"
    done
}
