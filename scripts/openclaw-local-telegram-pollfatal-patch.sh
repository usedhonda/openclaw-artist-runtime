#!/usr/bin/env bash
# Telegram polling fatal-error recurrence-proofing (2026-06-12 incident).
#
# Root cause chain (bundled OpenClaw dist, main-thread polling path):
#   1. monitor-polling.runtime-*.js #runPollingCycle classifies an error as
#      non-recoverable and re-throws it WITHOUT logging:
#        if (!isConflict && !isRecoverable) throw err;
#   2. runUntilAbort() has no catch around the cycle loop, so the throw
#      escapes the loop.
#   3. The caller (probe-*.js: `await pollingSession.runUntilAbort();`) only
#      releases its lease in `finally` - no catch - so the whole Telegram
#      channel dies with ZERO log lines while the gateway process stays up
#      (healthz 200, outbound sends fine). Inbound messages are then consumed
#      by the held long-poll and dropped, or never fetched at all.
#
# Observed: gateway log goes silent right after "polling cycle started";
# producer /resume texts vanish (pending_update_count=0, no plugin dispatch).
#
# Fix: convert the silent re-throw into a logged restart-with-backoff cycle.
# A truly fatal condition (e.g. revoked token) now logs on every backoff
# attempt instead of dying invisibly - acceptable for an unattended
# producer-room where silent inbound death is the worst failure mode.
#
# This file patches a vendored (gitignored) bundled dist; `npm upgrade` of the
# bundled openclaw silently restores the original code. Re-run this script
# after any such upgrade, then restart the gateway.
#
# Idempotent: already-patched files are skipped. A timestamped .bak is written
# before the first patch of each file. ASCII-only (macOS zsh safe).
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

dist_glob="${script_dir}/../.local/openclaw/tools/node-v"*/lib/node_modules/openclaw/dist

needle='if (!isConflict && !isRecoverable) throw err;'
marker='polling cycle fatal (non-recoverable)'

found_any=0
patched_any=0
already=0

for dist in ${dist_glob}; do
  [ -d "${dist}" ] || continue
  for file in "${dist}"/monitor-polling.runtime-*.js; do
    [ -f "${file}" ] || continue
    case "${file}" in
      *.bak-*) continue ;;
    esac
    found_any=1
    if grep -qF "${marker}" "${file}"; then
      already=$((already + 1))
      echo "already patched: ${file}"
      continue
    fi
    if ! grep -qF "${needle}" "${file}"; then
      echo "WARN: needle not found (bundled code changed?): ${file}" >&2
      continue
    fi
    count="$(grep -cF "${needle}" "${file}")"
    if [ "${count}" != "1" ]; then
      echo "WARN: needle not unique (count=${count}); refusing to patch: ${file}" >&2
      continue
    fi
    backup="${file}.bak-pre-pollfatal-$(date -u +%Y%m%dT%H%M%SZ)"
    cp "${file}" "${backup}"
    python3 - "${file}" <<'PYEOF'
import sys

path = sys.argv[1]
needle = "if (!isConflict && !isRecoverable) throw err;"
replacement = (
    "if (!isConflict && !isRecoverable) {\n"
    "\t\t\t\tconst fatalMsg = formatErrorMessage(err);\n"
    "\t\t\t\tthis.opts.log(`[telegram][diag] polling cycle fatal (non-recoverable): ${fatalMsg}; restarting instead of dying silently.`);\n"
    "\t\t\t\tthis.#transportState.markDirty();\n"
    "\t\t\t\treturn await this.#waitBeforeRestart((delay) => `Telegram polling hit a non-recoverable error: ${fatalMsg}; retrying in ${delay}.`) ? \"continue\" : \"exit\";\n"
    "\t\t\t}"
)

with open(path, "r", encoding="utf-8") as fh:
    source = fh.read()
if source.count(needle) != 1:
    raise SystemExit(f"needle count != 1 in {path}")
with open(path, "w", encoding="utf-8") as fh:
    fh.write(source.replace(needle, replacement))
print(f"patched: {path}")
PYEOF
    patched_any=$((patched_any + 1))
    echo "backup: ${backup}"
  done
done

if [ "${found_any}" = "0" ]; then
  echo "ERROR: no bundled monitor-polling.runtime-*.js found under ${dist_glob}" >&2
  exit 1
fi

echo "DONE: patched=${patched_any} already_patched=${already}"
if [ "${patched_any}" != "0" ]; then
  echo "Restart the gateway to load the patched polling code."
fi
