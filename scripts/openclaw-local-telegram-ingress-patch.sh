#!/usr/bin/env bash
# Plan v10.65 Layer 0 recurrence-proofing.
#
# The bundled OpenClaw runs Telegram getUpdates polling in an isolated
# worker_thread that uses a divergent undici dispatcher; in this sandbox that
# path goes silent (outbound notifications work, inbound receive dies). Forcing
# MAIN-THREAD polling fixes it. The lever is a default value inside the bundled
# dist: `opts.isolatedIngress?.enabled ?? true` -> flip the default to `false`.
#
# This file is vendored (gitignored) and is REWRITTEN by `npm upgrade` of the
# bundled openclaw, which silently restores worker-thread polling and kills
# inbound receive again. Re-run this script after any such upgrade to restore
# main-thread polling, then restart the gateway.
#
# Idempotent: already-patched files are skipped. A timestamped .bak is written
# before the first flip of each file. ASCII-only (macOS zsh safe).
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${script_dir}/openclaw-local-env.sh" >/dev/null 2>&1 || true

dist_glob="${script_dir}/../.local/openclaw/tools/node-v"*/lib/node_modules/openclaw/dist
# lever stem matches BOTH states so we can detect already-patched files (which
# contain `?? false`, i.e. no `?? true` needle).
lever='isolatedIngress?.enabled ??'
needle='isolatedIngress?.enabled ?? true'
replacement='isolatedIngress?.enabled ?? false'

found_any=0
patched_any=0
already=0

for dist in ${dist_glob}; do
  [ -d "${dist}" ] || continue
  while IFS= read -r file; do
    [ -n "${file}" ] || continue
    # Never touch our own backups (they intentionally preserve the old default).
    case "${file}" in
      *.bak-*) continue ;;
    esac
    found_any=1
    if grep -qF "${replacement}" "${file}"; then
      already=$((already + 1))
      echo "already main-thread: ${file}"
      continue
    fi
    if ! grep -qF "${needle}" "${file}"; then
      # lever present but in an unexpected form; do not guess.
      echo "lever found but neither default literal present (skipping): ${file}"
      continue
    fi
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    cp "${file}" "${file}.bak-ingress-mainthread-${stamp}"
    # Use a literal, delimiter-safe in-place replacement.
    python3 - "${file}" "${needle}" "${replacement}" <<'PY'
import sys
path, needle, replacement = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, "r", encoding="utf-8") as handle:
    data = handle.read()
with open(path, "w", encoding="utf-8") as handle:
    handle.write(data.replace(needle, replacement))
PY
    patched_any=1
    echo "patched -> main-thread polling: ${file}"
  done < <(grep -rlF "${lever}" "${dist}" 2>/dev/null || true)
done

if [ "${found_any}" -eq 0 ]; then
  echo "no bundled openclaw dist with the ingress lever found; nothing to patch"
  exit 0
fi

if [ "${patched_any}" -eq 1 ]; then
  echo "DONE: main-thread polling enforced. Restart the gateway to apply:"
  echo "  bash ${script_dir}/openclaw-local-gateway stop && bash ${script_dir}/openclaw-local-gateway start"
else
  echo "DONE: already main-thread (no change). already_patched=${already}"
fi
