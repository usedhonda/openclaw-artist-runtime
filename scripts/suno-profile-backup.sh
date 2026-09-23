#!/usr/bin/env bash
set -euo pipefail

PROFILE_DIR="${1:-.openclaw-browser-profiles/suno}"
BACKUP_ROOT="${2:-.openclaw-browser-profiles/suno.backup}"
KEEP="${SUNO_PROFILE_BACKUP_KEEP:-7}"
STAMP="$(date -u +%F)"
SNAPSHOT_DIR="${BACKUP_ROOT}/${STAMP}"
ARCHIVE_PATH="${SNAPSHOT_DIR}/suno-profile.tar.gz"

if [ ! -d "$PROFILE_DIR" ]; then
  echo "Suno profile not found: ${PROFILE_DIR}" >&2
  exit 1
fi

mkdir -p "$SNAPSHOT_DIR"
tar -czf "$ARCHIVE_PATH" -C "$(dirname "$PROFILE_DIR")" "$(basename "$PROFILE_DIR")"
echo "snapshot=${ARCHIVE_PATH}"

find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d | sort | {
  count=0
  while IFS= read -r dir; do
    count=$((count + 1))
    echo "${dir}"
  done | while IFS= read -r dir; do
    total="$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
    if [ "$total" -gt "$KEEP" ]; then
      rm -rf "$dir"
      total=$((total - 1))
    fi
  done
}
