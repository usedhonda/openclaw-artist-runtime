#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "${script_dir}/openclaw-local-env.sh"

base_url="${OPENCLAW_LOCAL_GATEWAY_HTTP_URL}"

check_endpoint() {
  local path="$1"
  local target="${base_url}${path}"
  echo "GET ${target}"
  curl -fsS "${target}" >/dev/null
}

check_endpoint "/plugins/artist-runtime"
check_endpoint "/plugins/artist-runtime/api/status"
check_endpoint "/plugins/artist-runtime/api/config"
check_endpoint "/plugins/artist-runtime/api/songs"
check_endpoint "/plugins/artist-runtime/api/alerts"

echo "artist-runtime http smoke passed"
