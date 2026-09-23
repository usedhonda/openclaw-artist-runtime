#!/usr/bin/env bash
set -euo pipefail

ROOT="."
DRY_RUN=0
YES=0

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
    -y|--yes)
      YES=1
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

RUNTIME="${ROOT%/}/runtime"
echo "Retention policy:"
echo "  suno run artifacts: 30 days"
echo "  social archive ledgers: 90 days"
echo "  prompt ledgers: 365 days"

CANDIDATES=()
while IFS= read -r candidate; do
  CANDIDATES+=("$candidate")
done < <({
  find "$RUNTIME/suno" -mindepth 1 -maxdepth 1 -type d -mtime +30 -print 2>/dev/null
  find "${ROOT%/}/songs" -path "*/social/social-publish.archive.jsonl" -type f -mtime +90 -print 2>/dev/null
  find "${ROOT%/}/songs" -path "*/prompts/prompt-ledger.jsonl" -type f -mtime +365 -print 2>/dev/null
} | sort)

if [[ ${#CANDIDATES[@]} -eq 0 ]]; then
  echo "No retention candidates."
  exit 0
fi

printf '  %s\n' "${CANDIDATES[@]}"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Dry-run only. No files or directories deleted."
  exit 0
fi

if [[ "$YES" -ne 1 ]]; then
  printf "Delete retention candidates? Type yes to continue: "
  read -r ANSWER
  if [[ "$ANSWER" != "yes" ]]; then
    echo "Aborted."
    exit 0
  fi
fi

rm -rf -- "${CANDIDATES[@]}"
echo "Deleted ${#CANDIDATES[@]} retention candidate(s)."
