#!/bin/bash
set -euo pipefail

exec /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --remote-allow-origins=http://127.0.0.1:9222 \
  "$@"
