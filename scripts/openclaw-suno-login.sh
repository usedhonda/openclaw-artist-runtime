#!/usr/bin/env bash
set -euo pipefail

# Manual operator action only.
# Do not run from CI, unattended agents, or autopilot.
#
# OPTIONAL/LEGACY: the plugin now opens the Suno browser itself on Producer Console
# Connect (SunoBrowserService), so first-time login normally happens there. This
# script remains as an optional manual login path (diagnostics / headless recovery).

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE_PATH="${1:-$ROOT_DIR/.openclaw-browser-profiles/suno}"

mkdir -p "$PROFILE_PATH"

if ! node -e 'import("playwright").then(() => process.exit(0)).catch(() => process.exit(1))'; then
  echo "playwright is not installed in this project. Run: npm install playwright" >&2
  exit 1
fi

node "$ROOT_DIR/scripts/openclaw-suno-login.mjs" "$PROFILE_PATH"
