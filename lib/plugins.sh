# lib/plugins.sh — Plugin installation and management
# Dokku docs: https://dokku.com/docs/advanced-usage/plugin-management/
# Commands: plugin:*

#!/usr/bin/env bash
# Dokku plugin management

ensure_plugins() {
    local plugins_defined
    plugins_defined=$(yaml_get '.plugins | keys | .[]' 2>/dev/null || true)
    [[ -z "$plugins_defined" || "$plugins_defined" == "null" ]] && return 0

    # Get currently installed plugins
    local installed
    installed=$(dokku_cmd plugin:list 2>/dev/null || true)

    while IFS= read -r plugin_name; do
        [[ -z "$plugin_name" ]] && continue

        # Check if already installed (plugin name appears in plugin:list output)
        if echo "$installed" | grep -q "  ${plugin_name} "; then
            log_action "plugins" "Plugin $plugin_name"
            log_skip
            continue
        fi

        local url version
        url=$(yaml_get ".plugins.${plugin_name}.url")
        version=$(yaml_get ".plugins.${plugin_name}.version")

        if [[ -z "$url" ]]; then
            log_error "plugins" "No URL specified for plugin: $plugin_name"
            continue
        fi

        log_action "plugins" "Installing $plugin_name"
        if [[ -n "$version" ]]; then
            dokku_cmd plugin:install "$url" --committish "$version"
        else
            dokku_cmd plugin:install "$url"
        fi
        log_done
    done <<< "$plugins_defined"
}
