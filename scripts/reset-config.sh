#!/usr/bin/env bash
set -euo pipefail

ROOT="."
DEFAULT_FILE="config.default.json"

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
    --default)
      DEFAULT_FILE="${2:-}"
      [[ -n "$DEFAULT_FILE" ]] || {
        echo "--default requires a path" >&2
        exit 1
      }
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

TARGET="${ROOT%/}/runtime/config-overrides.json"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if [[ ! -f "$DEFAULT_FILE" ]]; then
  echo "Default config not found: $DEFAULT_FILE" >&2
  exit 1
fi

mkdir -p "$(dirname "$TARGET")"
if [[ -f "$TARGET" ]]; then
  cp "$TARGET" "${TARGET}.bak.${STAMP}"
  echo "backup=${TARGET}.bak.${STAMP}"
fi

cp "$DEFAULT_FILE" "$TARGET"
echo "reset=${TARGET}"
