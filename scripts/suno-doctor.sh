#!/bin/bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dist_file="$root_dir/dist/services/sunoDoctor.js"
src_file="$root_dir/src/services/sunoDoctor.ts"

if [ ! -f "$dist_file" ] || [ "$src_file" -nt "$dist_file" ]; then
  echo "Building runtime doctor..." >&2
  (cd "$root_dir" && npm run --silent build:runtime) >&2
fi

exec node "$dist_file" "$@"
