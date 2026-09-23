#!/usr/bin/env bash
set -euo pipefail

ROOT="."
DRY_RUN=0
JSON=0
MAX_SIZE_MB="${OPENCLAW_LOG_MAX_SIZE_MB:-100}"
MAX_AGE_DAYS="${OPENCLAW_LOG_MAX_AGE_DAYS:-14}"

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
    --dry-run)
      DRY_RUN=1
      shift
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

RUNTIME="${ROOT%/}/runtime"
ARCHIVE_ROOT="${RUNTIME}/logs-archive"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE_DIR="${ARCHIVE_ROOT}/${STAMP}"
TMP_CANDIDATES="${TMPDIR:-/tmp}/artist-runtime-log-rotate-$$.txt"
trap 'rm -f "$TMP_CANDIDATES"' EXIT

json_string() {
  node -e 'process.stdout.write(JSON.stringify(process.argv[1] || ""))' "$1"
}

if [[ ! -d "$RUNTIME" ]]; then
  if [[ "$JSON" -eq 1 ]]; then
    printf '{"runtime":%s,"dryRun":%s,"rotated":0,"candidates":[]}\n' "$(json_string "$RUNTIME")" "$([[ "$DRY_RUN" -eq 1 ]] && echo true || echo false)"
  else
    echo "No runtime directory found: $RUNTIME"
  fi
  exit 0
fi

find "$RUNTIME" -maxdepth 1 -type f -name "*.log" \( -size +"${MAX_SIZE_MB}"M -o -mtime +"${MAX_AGE_DAYS}" \) -print | sort > "$TMP_CANDIDATES"

if [[ "$JSON" -eq 1 ]]; then
  printf '{"runtime":%s,"archiveDir":%s,"dryRun":%s,"rotated":' "$(json_string "$RUNTIME")" "$(json_string "$ARCHIVE_DIR")" "$([[ "$DRY_RUN" -eq 1 ]] && echo true || echo false)"
  wc -l < "$TMP_CANDIDATES" | tr -d ' '
  printf ',"candidates":['
  INDEX=0
  while IFS= read -r candidate; do
    [[ -z "$candidate" ]] && continue
    [[ "$INDEX" -gt 0 ]] && printf ','
    printf '%s' "$(json_string "$candidate")"
    INDEX=$((INDEX + 1))
  done < "$TMP_CANDIDATES"
  printf ']}\n'
else
  COUNT="$(wc -l < "$TMP_CANDIDATES" | tr -d ' ')"
  if [[ "$COUNT" -eq 0 ]]; then
    echo "No runtime log rotation candidates."
  else
    echo "Runtime log rotation candidates:"
    sed 's/^/  /' "$TMP_CANDIDATES"
  fi
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  exit 0
fi

if [[ ! -s "$TMP_CANDIDATES" ]]; then
  exit 0
fi

mkdir -p "$ARCHIVE_DIR"
while IFS= read -r candidate; do
  [[ -z "$candidate" ]] && continue
  base="$(basename "$candidate")"
  mv "$candidate" "${ARCHIVE_DIR}/${base}"
  : > "$candidate"
done < "$TMP_CANDIDATES"
