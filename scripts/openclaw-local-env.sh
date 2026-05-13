#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

openclaw_local_root="${repo_root}/.local/openclaw"
openclaw_local_prefix="${openclaw_local_root}"
openclaw_local_home="${openclaw_local_root}/home"
openclaw_local_state="${openclaw_local_root}/state"
openclaw_local_config_dir="${openclaw_local_root}/config"
openclaw_local_config_path="${openclaw_local_config_dir}/openclaw.json"
openclaw_local_workspace="${openclaw_local_root}/workspace"
openclaw_local_logs="${openclaw_local_root}/logs"
openclaw_local_gateway_pid="${openclaw_local_logs}/gateway.pid"
openclaw_local_gateway_log="${openclaw_local_logs}/gateway.log"
openclaw_local_gateway_port="${OPENCLAW_LOCAL_GATEWAY_PORT:-43134}"
openclaw_local_gateway_http_url="http://127.0.0.1:${openclaw_local_gateway_port}"
openclaw_local_gateway_ws_url="ws://127.0.0.1:${openclaw_local_gateway_port}"
social_credentials_path="${repo_root}/.local/social-credentials.env"

if [[ -f "${social_credentials_path}" ]]; then
  # shellcheck source=/dev/null
  source "${social_credentials_path}"
fi

export OPENCLAW_LOCAL_ROOT="${openclaw_local_root}"
export OPENCLAW_LOCAL_PREFIX="${openclaw_local_prefix}"
export OPENCLAW_HOME="${openclaw_local_home}"
export OPENCLAW_STATE_DIR="${openclaw_local_state}"
export OPENCLAW_CONFIG_PATH="${openclaw_local_config_path}"
export OPENCLAW_LOCAL_WORKSPACE="${openclaw_local_workspace}"
export OPENCLAW_LOCAL_LOGS="${openclaw_local_logs}"
export OPENCLAW_LOCAL_GATEWAY_PID="${openclaw_local_gateway_pid}"
export OPENCLAW_LOCAL_GATEWAY_LOG="${openclaw_local_gateway_log}"
export OPENCLAW_LOCAL_GATEWAY_PORT="${openclaw_local_gateway_port}"
export OPENCLAW_LOCAL_GATEWAY_HTTP_URL="${openclaw_local_gateway_http_url}"
export OPENCLAW_LOCAL_GATEWAY_WS_URL="${openclaw_local_gateway_ws_url}"
export PATH="${OPENCLAW_LOCAL_PREFIX}/bin:${PATH}"

if [[ -n "${BIRD_FIREFOX_PROFILE:-}" ]]; then
  export OPENCLAW_X_FIREFOX_PROFILE="${BIRD_FIREFOX_PROFILE}"
fi

if [[ -n "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  export TELEGRAM_BOT_TOKEN
fi

if [[ -n "${TELEGRAM_OWNER_USER_IDS:-}" ]]; then
  export TELEGRAM_OWNER_USER_IDS
fi

# v10.34 Layer 1 live lane. Uses system Chrome.app with an isolated
# user-data-dir and password-store=basic by default. CDP attach remains an
# emergency opt-in via OPENCLAW_SUNO_USE_CDP=on.
export OPENCLAW_SUNO_LIVE=on
export OPENCLAW_SUNO_CDP_ENDPOINT="${OPENCLAW_SUNO_CDP_ENDPOINT:-http://127.0.0.1:9222}"
export OPENCLAW_AUTOPILOT_DRYRUN_OVERRIDE=off

# v10.28-C: dashboard base URL for Telegram body Resources section.
export OPENCLAW_DASHBOARD_BASE_URL="${OPENCLAW_DASHBOARD_BASE_URL:-http://127.0.0.1:${openclaw_local_gateway_port}}"

# v10.30 polling watchdog after forward-fix (commits c8a8fbd + 5989af1).
# Watchdog now scoped to expire + 1 reprompt + audit-only, redispatch removed,
# watchdog actor blocked from external publish at registry + routing layers.
# Default off after real Telegram noise: reprompt-only still surfaced stale
# button choices as chat spam. Set a positive value only during supervised
# recovery drills.
export OPENCLAW_POLLING_WATCHDOG_MINUTES="${OPENCLAW_POLLING_WATCHDOG_MINUTES:-0}"
export OPENCLAW_POLLING_WATCHDOG_REPROMPT_ONCE=on

if [[ "${1:-}" == "print" ]]; then
  telegram_token_status=""
  if [[ -n "${TELEGRAM_BOT_TOKEN:-}" ]]; then
    telegram_token_status="<set>"
  fi
  cat <<EOF
OPENCLAW_LOCAL_ROOT=${OPENCLAW_LOCAL_ROOT}
OPENCLAW_LOCAL_PREFIX=${OPENCLAW_LOCAL_PREFIX}
OPENCLAW_HOME=${OPENCLAW_HOME}
OPENCLAW_STATE_DIR=${OPENCLAW_STATE_DIR}
OPENCLAW_CONFIG_PATH=${OPENCLAW_CONFIG_PATH}
OPENCLAW_LOCAL_WORKSPACE=${OPENCLAW_LOCAL_WORKSPACE}
OPENCLAW_LOCAL_LOGS=${OPENCLAW_LOCAL_LOGS}
OPENCLAW_LOCAL_GATEWAY_PID=${OPENCLAW_LOCAL_GATEWAY_PID}
OPENCLAW_LOCAL_GATEWAY_LOG=${OPENCLAW_LOCAL_GATEWAY_LOG}
OPENCLAW_LOCAL_GATEWAY_PORT=${OPENCLAW_LOCAL_GATEWAY_PORT}
OPENCLAW_LOCAL_GATEWAY_HTTP_URL=${OPENCLAW_LOCAL_GATEWAY_HTTP_URL}
OPENCLAW_LOCAL_GATEWAY_WS_URL=${OPENCLAW_LOCAL_GATEWAY_WS_URL}
OPENCLAW_X_FIREFOX_PROFILE=${OPENCLAW_X_FIREFOX_PROFILE:-}
TELEGRAM_OWNER_USER_IDS=${TELEGRAM_OWNER_USER_IDS:-}
EOF
  printf '%s=%s\n' 'TELEGRAM_BOT_TOKEN' "${telegram_token_status}"
fi
