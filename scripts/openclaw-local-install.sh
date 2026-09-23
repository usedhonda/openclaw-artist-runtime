#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "${script_dir}/openclaw-local-env.sh"

mkdir -p \
  "${OPENCLAW_LOCAL_ROOT}" \
  "${OPENCLAW_HOME}" \
  "${OPENCLAW_STATE_DIR}" \
  "$(dirname "${OPENCLAW_CONFIG_PATH}")" \
  "${OPENCLAW_LOCAL_WORKSPACE}" \
  "${OPENCLAW_LOCAL_LOGS}"

installer_tmp="$(mktemp)"
cleanup() {
  rm -f "${installer_tmp}"
}
trap cleanup EXIT

curl -fsSL --proto '=https' --tlsv1.2 "https://openclaw.ai/install-cli.sh" -o "${installer_tmp}"

echo "Installing OpenClaw into ${OPENCLAW_LOCAL_PREFIX}"
echo "State isolation:"
"${script_dir}/openclaw-local-env.sh" print

bash "${installer_tmp}" --prefix "${OPENCLAW_LOCAL_PREFIX}" --version latest --json

# The local Telegram transport fixes patch the installed OpenClaw dist and are
# overwritten by every install/update. Reapply them before the new runtime is
# allowed to start; either script fails closed if its expected upstream seam has
# changed.
"${script_dir}/openclaw-local-telegram-ingress-patch.sh"
"${script_dir}/openclaw-local-telegram-pollfatal-patch.sh"

echo
echo "Install finished."
echo "Use scripts/openclaw-local --help"
