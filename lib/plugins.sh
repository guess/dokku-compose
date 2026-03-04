# lib/plugins.sh — Plugin installation and management
# Dokku docs: https://dokku.com/docs/advanced-usage/plugin-management/
# Commands: plugin:*

#!/usr/bin/env bash
# Dokku plugin management

ensure_plugins() {
    local plugins_defined
    plugins_defined=$(yaml_get '.plugins | keys | .[]' 2>/dev/null || true)
    [[ -z "$plugins_defined" || "$plugins_defined" == "null" ]] && return 0

    while IFS= read -r plugin_name; do
        [[ -z "$plugin_name" ]] && continue

        local url version
        url=$(yaml_get ".plugins.${plugin_name}.url")
        version=$(yaml_get ".plugins.${plugin_name}.version")

        if [[ -z "$url" ]]; then
            log_error "plugins" "No URL specified for plugin: $plugin_name"
            continue
        fi

        if ! dokku_cmd_check plugin:installed "$plugin_name"; then
            log_action "plugins" "Installing $plugin_name"
            if [[ -n "$version" ]]; then
                dokku_cmd plugin:install "$url" --committish "$version" --name "$plugin_name"
            else
                dokku_cmd plugin:install "$url" --name "$plugin_name"
            fi
            log_done
        elif [[ -n "$version" ]]; then
            local current_version
            current_version=$(dokku_cmd plugin:list 2>/dev/null | awk -v n="${plugin_name}" '$1 == n {print $2}')
            if [[ "$current_version" != "$version" ]]; then
                log_action "plugins" "Updating $plugin_name ($current_version → $version)"
                dokku_cmd plugin:update "$plugin_name" "$version"
                log_done
            else
                log_action "plugins" "Plugin $plugin_name"
                log_skip
            fi
        else
            log_action "plugins" "Plugin $plugin_name"
            log_skip
        fi
    done <<< "$plugins_defined"
}
