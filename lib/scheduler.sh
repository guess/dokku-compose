# lib/scheduler.sh — Scheduler selection
# Dokku docs: https://dokku.com/docs/deployment/schedulers/scheduler-management/
# Commands: scheduler:*

#!/usr/bin/env bash
# Dokku scheduler selection

ensure_app_scheduler() {
    dokku_set_property "$1" "scheduler" "selected"
}
