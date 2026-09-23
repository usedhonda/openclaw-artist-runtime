#!/usr/bin/env bash
set -euo pipefail

ROOT="."
DRY_RUN=0
JSON=0
RETENTION_DAYS="${OPENCLAW_STATE_SNAPSHOT_RETENTION_DAYS:-30}"

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

STATE_DIR="${ROOT%/}/runtime/state"
SNAPSHOT_ROOT="${ROOT%/}/runtime/state-snapshots"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SNAPSHOT_DIR="${SNAPSHOT_ROOT}/${STAMP}"
TMP_PRUNED="${TMPDIR:-/tmp}/artist-runtime-state-snapshot-pruned-$$.txt"
trap 'rm -f "$TMP_PRUNED"' EXIT

json_string() {
  node -e 'process.stdout.write(JSON.stringify(process.argv[1] || ""))' "$1"
}

find "$SNAPSHOT_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +"$RETENTION_DAYS" -print 2>/dev/null | sort > "$TMP_PRUNED" || true

if [[ "$JSON" -eq 1 ]]; then
  printf '{"stateDir":%s,"snapshotDir":%s,"dryRun":%s,"created":' "$(json_string "$STATE_DIR")" "$(json_string "$SNAPSHOT_DIR")" "$([[ "$DRY_RUN" -eq 1 ]] && echo true || echo false)"
  if [[ -d "$STATE_DIR" && "$DRY_RUN" -ne 1 ]]; then
    printf 'true'
  else
    printf 'false'
  fi
  printf ',"pruned":['
  INDEX=0
  while IFS= read -r candidate; do
    [[ -z "$candidate" ]] && continue
    [[ "$INDEX" -gt 0 ]] && printf ','
    printf '%s' "$(json_string "$candidate")"
    INDEX=$((INDEX + 1))
  done < "$TMP_PRUNED"
  printf ']}\n'
else
  if [[ -d "$STATE_DIR" ]]; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "Would snapshot $STATE_DIR to $SNAPSHOT_DIR"
    else
      echo "Snapshotting $STATE_DIR to $SNAPSHOT_DIR"
    fi
  else
    echo "No runtime state directory found: $STATE_DIR"
  fi
  if [[ -s "$TMP_PRUNED" ]]; then
    echo "Snapshots older than $RETENTION_DAYS days:"
    sed 's/^/  /' "$TMP_PRUNED"
  fi
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  exit 0
fi

if [[ -d "$STATE_DIR" ]]; then
  mkdir -p "$SNAPSHOT_ROOT"
  cp -pR "$STATE_DIR" "$SNAPSHOT_DIR"
fi

while IFS= read -r candidate; do
  [[ -z "$candidate" ]] && continue
  rm -rf -- "$candidate"
done < "$TMP_PRUNED"
