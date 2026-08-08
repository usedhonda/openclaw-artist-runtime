#!/usr/bin/env bash
set -euo pipefail

# Manual operator action only.
# Do not run from CI, unattended agents, or autopilot.
#
# OPTIONAL/LEGACY: the plugin now opens the Suno browser itself on Producer Console
# Connect (SunoBrowserService), so first-time login normally happens there. This
# script remains as an optional manual login path (diagnostics / headless recovery).

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if ! node -e 'import("playwright").then(() => process.exit(0)).catch(() => process.exit(1))'; then
  echo "playwright is not installed in this project. Run: npm install playwright" >&2
  exit 1
fi

if [[ "${1:-}" == "--fresh" ]]; then
  if [[ $# -ne 1 ]]; then
    echo "usage: scripts/openclaw-suno-login.sh --fresh" >&2
    exit 2
  fi

  WORKSPACE_ROOT="${OPENCLAW_LOCAL_WORKSPACE:-$ROOT_DIR/.local/openclaw/workspace}"
  CLI_DATA_DIR="$WORKSPACE_ROOT/runtime/suno/cli"
  QUARANTINE_DIR="$CLI_DATA_DIR/auth-quarantine/$(date -u +%Y%m%dT%H%M%SZ)-$$"
  QUARANTINE_READY=false

  for AUTH_ENTRY in browser-profile session.json; do
    AUTH_PATH="$CLI_DATA_DIR/$AUTH_ENTRY"
    if [[ -e "$AUTH_PATH" || -L "$AUTH_PATH" ]]; then
      if [[ "$QUARANTINE_READY" == false ]]; then
        mkdir -p "$CLI_DATA_DIR/auth-quarantine"
        mkdir "$QUARANTINE_DIR"
        QUARANTINE_READY=true
      fi
      mv "$AUTH_PATH" "$QUARANTINE_DIR/$AUTH_ENTRY"
    fi
  done

  node "$ROOT_DIR/vendor/suno-cli/dist/src/cli.js" login \
    --data-dir "$CLI_DATA_DIR"
elif [[ $# -gt 0 ]]; then
  # Explicit profile paths remain the legacy Playwright browser-worker lane.
  PROFILE_PATH="$1"
  mkdir -p "$PROFILE_PATH"
  node "$ROOT_DIR/scripts/openclaw-suno-login.mjs" "$PROFILE_PATH"
else
  # The normal lane must refresh the profile and session.json consumed by suno-cli.
  WORKSPACE_ROOT="${OPENCLAW_LOCAL_WORKSPACE:-$ROOT_DIR/.local/openclaw/workspace}"
  node "$ROOT_DIR/vendor/suno-cli/dist/src/cli.js" login \
    --data-dir "$WORKSPACE_ROOT/runtime/suno/cli"
fi
