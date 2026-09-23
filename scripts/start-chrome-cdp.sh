#!/bin/bash
set -euo pipefail

# OPTIONAL/LEGACY (diagnostics / emergency only): the plugin now owns the Suno
# browser via SunoBrowserService with an ephemeral CDP port, so this fixed-9222
# Chrome launch is not part of the normal flow. Use it only to drive the advanced
# CDP-attach override (music.suno.browser.cdpEndpoint or OPENCLAW_SUNO_USE_CDP).

cdp_host="127.0.0.1"
cdp_port="9222"
cdp_endpoint="http://${cdp_host}:${cdp_port}/json/version"

if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 1 "$cdp_endpoint" >/dev/null 2>&1; then
  echo "warning: Chrome CDP already appears reachable at $cdp_endpoint" >&2
fi

if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$cdp_port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "warning: TCP port $cdp_port is already listening; Chrome launch may hit a CDP port conflict" >&2
elif command -v nc >/dev/null 2>&1 && nc -z "$cdp_host" "$cdp_port" >/dev/null 2>&1; then
  echo "warning: TCP port $cdp_port is reachable; Chrome launch may hit a CDP port conflict" >&2
fi

runtime_root="${OPENCLAW_ARTIST_RUNTIME_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
chrome_executable="${OPENCLAW_SUNO_CHROME_EXECUTABLE:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
profile_dir="${OPENCLAW_SUNO_CHROME_PROFILE_DEST:-${runtime_root}/.openclaw-browser-profiles/suno-cdp}"

exec "$chrome_executable" \
  --user-data-dir="$profile_dir" \
  --profile-directory=Default \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --remote-allow-origins=http://127.0.0.1:9222 \
  --no-first-run \
  --no-default-browser-check \
  "$@"
