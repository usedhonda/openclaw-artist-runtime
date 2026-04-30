#!/bin/bash
set -euo pipefail
exec /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --user-data-dir="/Users/usedhonda/projects/openclaw/artist-runtime/.openclaw-browser-profiles/suno-cdp" \
  --profile-directory=Default \
  --remote-debugging-port=9222 \
  --remote-allow-origins=http://127.0.0.1:9222 \
  --no-first-run \
  --no-default-browser-check \
  "$@"
