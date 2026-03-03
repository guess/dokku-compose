# lib/storage.sh — Persistent storage management
# Dokku docs: https://dokku.com/docs/advanced-usage/persistent-storage/
# Commands: storage:*

#!/usr/bin/env bash
# Dokku persistent storage management

ensure_app_storage() {
    local app="$1"

    yaml_app_has "$app" ".storage" || return 0

    local current
    current=$(dokku_cmd storage:report "$app" --storage-mounts 2>/dev/null || true)

    while IFS= read -r mount; do
        [[ -z "$mount" ]] && continue

        if echo "$current" | grep -qF "$mount"; then
            log_action "$app" "Storage $mount"
            log_skip
            continue
        fi

        log_action "$app" "Mounting $mount"
        dokku_cmd storage:mount "$app" "$mount"
        log_done
    done <<< "$(yaml_app_list "$app" ".storage[]")"
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
