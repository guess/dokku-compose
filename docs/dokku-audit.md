# Dokku Feature Audit

Systematic audit of all Dokku command namespaces for dokku-compose coverage.
See `docs/plans/2026-03-03-dokku-feature-audit-design.md` for methodology.

**Legend:**
- **supported** — Fully implemented in dokku-compose
- **partial** — Module exists but missing some declarative commands
- **planned** — Not yet implemented, has declarative commands worth supporting
- **skipped** — No declarative commands that make sense for dokku-compose

---

## Summary

| # | Namespace | Module | Status | Doc |
|---|-----------|--------|--------|-----|
| 1 | apps | apps.sh | pending | [link](https://dokku.com/docs/deployment/application-management/) |
| 2 | domains | apps.sh | pending | [link](https://dokku.com/docs/configuration/domains/) |
| 3 | config | config.sh | pending | [link](https://dokku.com/docs/configuration/environment-variables/) |
| 4 | certs | certs.sh | pending | [link](https://dokku.com/docs/configuration/ssl/) |
| 5 | network | network.sh | pending | [link](https://dokku.com/docs/networking/network/) |
| 6 | ports | ports.sh | pending | [link](https://dokku.com/docs/networking/port-management/) |
| 7 | nginx | nginx.sh | pending | [link](https://dokku.com/docs/networking/proxies/nginx/) |
| 8 | builder-* | builder.sh | pending | [link](https://dokku.com/docs/deployment/builders/herokuish-buildpacks/) |
| 9 | docker-options | builder.sh | pending | [link](https://dokku.com/docs/advanced-usage/docker-options/) |
| 10 | plugin | plugins.sh | pending | [link](https://dokku.com/docs/advanced-usage/plugin-management/) |
| 11 | version | dokku.sh | pending | [link](https://dokku.com/docs/getting-started/installation/) |
| 12 | git | git.sh | pending | [link](https://dokku.com/docs/deployment/methods/git/) |
| 13 | proxy | — | pending | [link](https://dokku.com/docs/networking/proxy-management/) |
| 14 | ps | — | pending | [link](https://dokku.com/docs/processes/process-management/) |
| 15 | storage | — | pending | [link](https://dokku.com/docs/advanced-usage/persistent-storage/) |
| 16 | resource | — | pending | [link](https://dokku.com/docs/advanced-usage/resource-management/) |
| 17 | registry | — | pending | [link](https://dokku.com/docs/advanced-usage/registry-management/) |
| 18 | scheduler | — | pending | [link](https://dokku.com/docs/deployment/schedulers/scheduler-management/) |
| 19 | checks | — | pending | [link](https://dokku.com/docs/deployment/zero-downtime-deploys/) |
| 20 | logs | — | pending | [link](https://dokku.com/docs/deployment/logs/) |
| 21 | cron | — | pending | [link](https://dokku.com/docs/processes/scheduled-cron-tasks/) |
| 22 | run | — | pending | [link](https://dokku.com/docs/processes/one-off-tasks/) |
| 23 | repo | — | pending | [link](https://dokku.com/docs/advanced-usage/repository-management/) |
| 24 | image | — | pending | [link](https://dokku.com/docs/deployment/methods/image/) |
| 25 | backup | — | pending | [link](https://dokku.com/docs/advanced-usage/backup-recovery/) |
| 26 | app-json | builder.sh | pending | [link](https://dokku.com/docs/appendices/file-formats/app-json/) |

---

<!-- Audit sections appended below by batch agents -->
