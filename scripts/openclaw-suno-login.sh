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
  # Launch the matching visible Chrome bundle through LaunchServices, then attach
  # explicitly over loopback. This avoids the known launchPersistentContext crash
  # against the authenticated CLI profile; a failed attach never falls back.
  WORKSPACE_ROOT="${OPENCLAW_LOCAL_WORKSPACE:-$ROOT_DIR/.local/openclaw/workspace}"
  CLI_DATA_DIR="$WORKSPACE_ROOT/runtime/suno/cli"
  CDP_PORT="${OPENCLAW_SUNO_LOGIN_CDP_PORT:-9222}"
  CDP_HOST="127.0.0.1"
  CDP_ENDPOINT="http://${CDP_HOST}:${CDP_PORT}"

  if curl -fsS --max-time 1 "$CDP_ENDPOINT/json/version" >/dev/null 2>&1; then
    echo "Suno login CDP port is already in use: $CDP_ENDPOINT" >&2
    exit 1
  fi
  if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$CDP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Suno login CDP port is already in use: $CDP_ENDPOINT" >&2
    exit 1
  fi

  if [[ -n "${OPENCLAW_SUNO_CHROME_EXECUTABLE:-}" ]]; then
    CHROME_EXECUTABLE="$OPENCLAW_SUNO_CHROME_EXECUTABLE"
  else
    CHROME_EXECUTABLE="$(node -e 'import("playwright").then(({ chromium }) => { const executable = chromium.executablePath(); if (!executable) process.exit(1); process.stdout.write(executable); }).catch(() => process.exit(1))')"
  fi
  if [[ -z "$CHROME_EXECUTABLE" || ! -x "$CHROME_EXECUTABLE" ]]; then
    echo "Suno login could not resolve an executable Chrome browser." >&2
    exit 1
  fi
  case "$CHROME_EXECUTABLE" in
    */Contents/MacOS/*)
      CHROME_APP="${CHROME_EXECUTABLE%%/Contents/MacOS/*}"
      ;;
    *)
      echo "Suno login requires a Chrome app executable under a .app bundle: $CHROME_EXECUTABLE" >&2
      exit 1
      ;;
  esac
  if [[ "$CHROME_APP" != *.app || ! -d "$CHROME_APP" ]]; then
    echo "Suno login requires an executable inside a Chrome .app bundle." >&2
    exit 1
  fi

  open -na "$CHROME_APP" --args \
    --user-data-dir="$CLI_DATA_DIR/browser-profile" \
    --profile-directory=Default \
    --remote-debugging-address="$CDP_HOST" \
    --remote-debugging-port="$CDP_PORT" \
    --remote-allow-origins="$CDP_ENDPOINT" \
    --password-store=basic \
    --no-first-run \
    --no-default-browser-check \
    https://suno.com/

  for _ in {1..40}; do
    if curl -fsS --max-time 1 "$CDP_ENDPOINT/json/version" >/dev/null 2>&1; then
      exec node "$ROOT_DIR/vendor/suno-cli/dist/src/cli.js" login \
        --data-dir "$CLI_DATA_DIR" \
        --cdp-endpoint "$CDP_ENDPOINT"
    fi
    sleep 0.5
  done
  echo "Suno login Chrome did not expose loopback CDP: $CDP_ENDPOINT" >&2
  exit 1
fi
