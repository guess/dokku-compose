#!/usr/bin/env bash
# Bundle dokku-compose into a single self-contained script
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${SCRIPT_DIR}/.."
BIN_FILE="${PROJECT_ROOT}/bin/dokku-compose"
LIB_DIR="${PROJECT_ROOT}/lib"

# Start with shebang and bundle marker
echo '#!/usr/bin/env bash'
echo '# dokku-compose - Declarative Dokku deployment orchestrator (bundled)'
echo 'DOKKU_COMPOSE_BUNDLED=1'
echo ''

# Inline core libraries first (order matters)
for lib in core.sh yaml.sh; do
    echo "# --- lib/${lib} ---"
    # Strip shebang lines from lib files
    sed '/^#!/d' "${LIB_DIR}/${lib}"
    echo ''
done

# Inline module files
for module in apps network plugins services ports certs nginx config builder dokku git; do
    if [[ -f "${LIB_DIR}/${module}.sh" ]]; then
        echo "# --- lib/${module}.sh ---"
        sed '/^#!/d' "${LIB_DIR}/${module}.sh"
        echo ''
    fi
done

# Inline entry point, stripping shebang and the "dokku-compose" header comment
# The DOKKU_COMPOSE_BUNDLED guard in the entry point skips the source block
sed '/^#!/d; /^# dokku-compose/d' "${BIN_FILE}"
