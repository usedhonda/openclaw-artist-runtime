#!/usr/bin/env bash
set -euo pipefail

ROOT="."
JSON=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root)
      ROOT="${2:-}"
      [[ -n "$ROOT" ]] || {
        echo "--root requires a path" >&2
        exit 1
      }
      shift 2
      ;;
    --json)
      JSON=1
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

TARGET="${ROOT%/}/runtime"
if [[ ! -d "$TARGET" ]]; then
  [[ "$JSON" -eq 1 ]] && echo '{"runtime":"'"$TARGET"'","entries":[]}' || echo "No runtime directory found: $TARGET"
  exit 0
fi

ENTRIES=()
while IFS= read -r entry; do
  ENTRIES+=("$entry")
done < <(find "$TARGET" -mindepth 1 -maxdepth 1 -type d -print | sort)
if [[ "$JSON" -eq 1 ]]; then
  printf '{"runtime":"%s","entries":[' "$TARGET"
  for index in "${!ENTRIES[@]}"; do
    size="$(du -sh "${ENTRIES[$index]}" 2>/dev/null | awk '{print $1}')"
    [[ "$index" -gt 0 ]] && printf ','
    printf '{"path":"%s","size":"%s"}' "${ENTRIES[$index]}" "${size:-unknown}"
  done
  printf ']}\n'
  exit 0
fi

printf "%-48s %s\n" "Path" "Size"
for entry in "${ENTRIES[@]}"; do
  du -sh "$entry" 2>/dev/null | awk '{printf "%-48s %s\n", $2, $1}'
done
