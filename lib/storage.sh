# lib/storage.sh — Persistent storage management
# Dokku docs: https://dokku.com/docs/advanced-usage/persistent-storage/
# Commands: storage:*

#!/usr/bin/env bash
# Dokku persistent storage management

ensure_app_storage() {
    local app="$1"

    yaml_app_has "$app" ".storage" || return 0

    local current desired
    current=$(dokku_cmd storage:report "$app" --storage-mounts 2>/dev/null || true)
    desired=$(yaml_app_list "$app" ".storage[]")

    # Unmount stale mounts (present in Dokku but not in YAML)
    while IFS= read -r mount; do
        [[ -z "$mount" ]] && continue
        if ! printf '%s\n' "$desired" | grep -qxF "$mount"; then
            log_action "$app" "Unmounting stale $mount"
            dokku_cmd storage:unmount "$app" "$mount"
            log_done
        fi
    done <<< "$current"

    # Mount new mounts (in YAML but not yet in Dokku)
    while IFS= read -r mount; do
        [[ -z "$mount" ]] && continue
        if printf '%s\n' "$current" | grep -qxF "$mount"; then
            log_action "$app" "Storage $mount"
            log_skip
        else
            log_action "$app" "Mounting $mount"
            dokku_cmd storage:mount "$app" "$mount"
            log_done
        fi
    done <<< "$desired"
}

destroy_app_storage() {
    local app="$1"

    yaml_app_has "$app" ".storage" || return 0

    while IFS= read -r mount; do
        [[ -z "$mount" ]] && continue
        log_action "$app" "Unmounting $mount"
        dokku_cmd storage:unmount "$app" "$mount"
        log_done
    done <<< "$(yaml_app_list "$app" ".storage[]")"
}
