# lib/logs.sh — Log management
# Dokku docs: https://dokku.com/docs/deployment/logs/
# Commands: logs:*

#!/usr/bin/env bash
# Dokku log management

ensure_app_logs() {
    dokku_set_properties "$1" "logs"
}
