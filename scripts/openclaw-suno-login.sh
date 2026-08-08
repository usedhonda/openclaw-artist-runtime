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

if [[ $# -gt 0 ]]; then
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
