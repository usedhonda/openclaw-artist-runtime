#!/usr/bin/env bash
set -euo pipefail

YES=0
DRY_RUN=0
JSON=0
CRON=0
ROOT="."
DAYS=30

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)
      YES=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --json)
      JSON=1
      shift
      ;;
    --cron)
      CRON=1
      YES=1
      shift
      ;;
    --root)
      ROOT="${2:-}"
      [[ -n "$ROOT" ]] || {
        echo "--root requires a path" >&2
        exit 1
      }
      shift 2
      ;;
    --days)
      DAYS="${2:-}"
      [[ "$DAYS" =~ ^[0-9]+$ ]] || {
        echo "--days requires a whole number" >&2
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

TARGET="${ROOT%/}/runtime/suno"
PROFILE_SNAPSHOT_TARGET="${TARGET}/profile-snapshots"
PROFILE_SNAPSHOT_DAYS=365
if [[ ! -d "$TARGET" ]]; then
  if [[ "$JSON" -eq 1 ]]; then
    echo '{"target":"'"$TARGET"'","deleted":0,"candidates":[]}'
    exit 0
  fi
  echo "No runtime Suno directory found: $TARGET"
  exit 0
fi

CANDIDATES=()
while IFS= read -r candidate; do
  CANDIDATES+=("$candidate")
done < <(find "$TARGET" -mindepth 1 -maxdepth 1 -type d ! -name "profile-snapshots" -mtime +"$DAYS" -print | sort)

PROFILE_SNAPSHOT_CANDIDATES=()
if [[ -d "$PROFILE_SNAPSHOT_TARGET" ]]; then
  while IFS= read -r candidate; do
    PROFILE_SNAPSHOT_CANDIDATES+=("$candidate")
  done < <(find "$PROFILE_SNAPSHOT_TARGET" -mindepth 1 -maxdepth 1 -mtime +"$PROFILE_SNAPSHOT_DAYS" -print | sort)
fi

if [[ ${#CANDIDATES[@]} -eq 0 && ${#PROFILE_SNAPSHOT_CANDIDATES[@]} -eq 0 ]]; then
  if [[ "$JSON" -eq 1 ]]; then
    echo '{"target":"'"$TARGET"'","deleted":0,"candidates":[],"profileSnapshotRetentionDays":365,"profileSnapshotCandidates":[]}'
    exit 0
  fi
  echo "No runtime Suno run directories older than $DAYS days and no profile snapshots older than $PROFILE_SNAPSHOT_DAYS days."
  exit 0
fi

if [[ "$JSON" -ne 1 ]]; then
  if [[ ${#CANDIDATES[@]} -gt 0 ]]; then
    echo "Runtime Suno directories older than $DAYS days:"
    printf '  %s\n' "${CANDIDATES[@]}"
  fi
  if [[ ${#PROFILE_SNAPSHOT_CANDIDATES[@]} -gt 0 ]]; then
    echo "Suno profile snapshots older than $PROFILE_SNAPSHOT_DAYS days:"
    printf '  %s\n' "${PROFILE_SNAPSHOT_CANDIDATES[@]}"
  fi
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  if [[ "$JSON" -eq 1 ]]; then
    printf '{"target":"%s","dryRun":true,"cron":%s,"deleted":0,"candidates":[' "$TARGET" "$([[ "$CRON" -eq 1 ]] && echo true || echo false)"
    for index in "${!CANDIDATES[@]}"; do
      [[ "$index" -gt 0 ]] && printf ','
      printf '"%s"' "${CANDIDATES[$index]}"
    done
    printf '],"profileSnapshotRetentionDays":%s,"profileSnapshotCandidates":[' "$PROFILE_SNAPSHOT_DAYS"
    for index in "${!PROFILE_SNAPSHOT_CANDIDATES[@]}"; do
      [[ "$index" -gt 0 ]] && printf ','
      printf '"%s"' "${PROFILE_SNAPSHOT_CANDIDATES[$index]}"
    done
    printf ']}\n'
  fi
  [[ "$JSON" -ne 1 ]] && echo "Dry-run only. No directories deleted."
  exit 0
fi

if [[ "$YES" -ne 1 ]]; then
  printf "Delete these directories? Type yes to continue: "
  read -r ANSWER
  if [[ "$ANSWER" != "yes" ]]; then
    echo "Aborted."
    exit 0
  fi
fi

[[ ${#CANDIDATES[@]} -gt 0 ]] && rm -rf -- "${CANDIDATES[@]}"
[[ ${#PROFILE_SNAPSHOT_CANDIDATES[@]} -gt 0 ]] && rm -rf -- "${PROFILE_SNAPSHOT_CANDIDATES[@]}"
if [[ "$JSON" -eq 1 ]]; then
  DELETED_TOTAL=$(( ${#CANDIDATES[@]} + ${#PROFILE_SNAPSHOT_CANDIDATES[@]} ))
  printf '{"target":"%s","dryRun":false,"cron":%s,"deleted":%s,"candidates":[' "$TARGET" "$([[ "$CRON" -eq 1 ]] && echo true || echo false)" "$DELETED_TOTAL"
  for index in "${!CANDIDATES[@]}"; do
    [[ "$index" -gt 0 ]] && printf ','
    printf '"%s"' "${CANDIDATES[$index]}"
  done
  printf '],"profileSnapshotRetentionDays":%s,"profileSnapshotCandidates":[' "$PROFILE_SNAPSHOT_DAYS"
  for index in "${!PROFILE_SNAPSHOT_CANDIDATES[@]}"; do
    [[ "$index" -gt 0 ]] && printf ','
    printf '"%s"' "${PROFILE_SNAPSHOT_CANDIDATES[$index]}"
  done
  printf ']}\n'
fi
if [[ "$JSON" -ne 1 ]]; then
  DELETED_TOTAL=$(( ${#CANDIDATES[@]} + ${#PROFILE_SNAPSHOT_CANDIDATES[@]} ))
  echo "Deleted $DELETED_TOTAL runtime Suno item$( [[ $DELETED_TOTAL -eq 1 ]] && echo '' || echo 's' )."
fi
