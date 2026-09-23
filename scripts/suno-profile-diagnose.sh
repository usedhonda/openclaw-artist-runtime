#!/usr/bin/env bash
set -euo pipefail

PROFILE_DIR="${1:-.openclaw-browser-profiles/suno}"

echo "profile_path=${PROFILE_DIR}"

if [ ! -d "$PROFILE_DIR" ]; then
  echo "profile_state=missing"
  echo "cookie_files=0"
  echo "storage_usage=0"
  exit 0
fi

cookie_files="$(find "$PROFILE_DIR" -type f \( -iname "cookies" -o -iname "*cookie*" \) 2>/dev/null | wc -l | tr -d ' ')"
latest_file="$(find "$PROFILE_DIR" -type f -print 2>/dev/null | while IFS= read -r file; do
  if stat -f "%m %N" "$file" >/dev/null 2>&1; then
    stat -f "%m %N" "$file"
  else
    stat -c "%Y %n" "$file"
  fi
done | sort -nr | head -n 1 | cut -d' ' -f2-)"
storage_usage="$(du -sh "$PROFILE_DIR" 2>/dev/null | awk '{print $1}')"

echo "profile_state=present"
echo "cookie_files=${cookie_files}"
echo "latest_file=${latest_file:-none}"
echo "storage_usage=${storage_usage:-unknown}"
