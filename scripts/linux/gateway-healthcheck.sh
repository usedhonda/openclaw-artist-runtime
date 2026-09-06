#!/usr/bin/env bash
# Polls the artist-runtime gateway status endpoint and a heartbeat file, and
# reports pass/fail as one log line. Meant to be run periodically by
# openclaw-artist-healthcheck.timer.template; always exits 0 so the timer
# loop itself never stops on a failing check.
#
# Failure = the HTTP status endpoint did not answer 200, OR the heartbeat
# file is missing/older than HEARTBEAT_MAX_AGE_SEC.
set -euo pipefail

GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:43134/plugins/artist-runtime/api/status}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-.}"
HEARTBEAT_MAX_AGE_SEC="${HEARTBEAT_MAX_AGE_SEC:-900}"
FAIL_THRESHOLD="${FAIL_THRESHOLD:-3}"
HTTP_TIMEOUT_SEC="${HTTP_TIMEOUT_SEC:-10}"
STATE_FILE="${STATE_FILE:-${WORKSPACE_ROOT%/}/runtime/gateway-healthcheck-state.json}"
NOTIFY_CMD="${NOTIFY_CMD:-}"

# Heartbeat source: prefer runtime/supervisor-heartbeat.json (written every
# ~15s by scripts/openclaw-local-gateway-supervisor whenever the gateway
# process is up, regardless of autopilot activity) over
# runtime/autopilot-heartbeat.json (only advances when an autopilot tick
# runs, so it stays stale for hours/days on a host where autopilot is
# intentionally disabled and would false-fail the check). HEARTBEAT_FILE
# overrides this selection entirely.
if [[ -z "${HEARTBEAT_FILE:-}" ]]; then
  supervisor_heartbeat_default="${WORKSPACE_ROOT%/}/runtime/supervisor-heartbeat.json"
  autopilot_heartbeat_default="${WORKSPACE_ROOT%/}/runtime/autopilot-heartbeat.json"
  if [[ -f "${supervisor_heartbeat_default}" ]]; then
    HEARTBEAT_FILE="${supervisor_heartbeat_default}"
  else
    HEARTBEAT_FILE="${autopilot_heartbeat_default}"
  fi
fi
HEARTBEAT_FILE_NAME="$(basename "${HEARTBEAT_FILE}")"
NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

log() {
  printf '[%s] %s\n' "$NOW_ISO" "$1"
}

notify() {
  if [[ -n "$NOTIFY_CMD" ]]; then
    "$NOTIFY_CMD" "$1" || true
  fi
}

http_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "$HTTP_TIMEOUT_SEC" "$GATEWAY_URL" 2>/dev/null || echo "000")"
http_ok=0
[[ "$http_status" == "200" ]] && http_ok=1

heartbeat_age_sec="missing"
heartbeat_ok=0
if [[ -f "$HEARTBEAT_FILE" ]]; then
  heartbeat_age_sec="$(node -e '
    const fs = require("fs");
    try {
      const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      // Accept either the autopilot heartbeat shape (updatedAt) or the
      // supervisor heartbeat shape (timestamp); either may be an ISO
      // string or an epoch-ms number.
      const raw = data.updatedAt ?? data.timestamp;
      let updatedMs = NaN;
      if (typeof raw === "number") {
        updatedMs = raw;
      } else if (typeof raw === "string") {
        updatedMs = Date.parse(raw);
        if (!Number.isFinite(updatedMs) && /^[0-9]+$/.test(raw)) {
          updatedMs = Number(raw);
        }
      }
      if (Number.isFinite(updatedMs)) {
        process.stdout.write(String(Math.max(0, Math.floor((Date.now() - updatedMs) / 1000))));
      }
    } catch {}
  ' "$HEARTBEAT_FILE" 2>/dev/null || true)"
  if [[ -n "$heartbeat_age_sec" && "$heartbeat_age_sec" =~ ^[0-9]+$ && "$heartbeat_age_sec" -le "$HEARTBEAT_MAX_AGE_SEC" ]]; then
    heartbeat_ok=1
  fi
  [[ -z "$heartbeat_age_sec" ]] && heartbeat_age_sec="unreadable"
fi

overall_ok=0
[[ "$http_ok" -eq 1 && "$heartbeat_ok" -eq 1 ]] && overall_ok=1

mkdir -p "$(dirname "$STATE_FILE")"
prev_failures=0
if [[ -f "$STATE_FILE" ]]; then
  prev_failures="$(node -e '
    try {
      const data = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      const n = Number(data.consecutiveFailures);
      process.stdout.write(String(Number.isFinite(n) ? n : 0));
    } catch {
      process.stdout.write("0");
    }
  ' "$STATE_FILE" 2>/dev/null || echo 0)"
fi
[[ "$prev_failures" =~ ^[0-9]+$ ]] || prev_failures=0

if [[ "$overall_ok" -eq 1 ]]; then
  consecutive_failures=0
else
  consecutive_failures=$((prev_failures + 1))
fi

reason=""
if [[ "$http_ok" -ne 1 ]]; then
  reason="http_status=${http_status}"
fi
if [[ "$heartbeat_ok" -ne 1 ]]; then
  [[ -n "$reason" ]] && reason="${reason} "
  reason="${reason}heartbeat_file=${HEARTBEAT_FILE_NAME} heartbeat_age_sec=${heartbeat_age_sec}"
fi

node -e '
  const fs = require("fs");
  const [file, ok, failures, ts] = process.argv.slice(1);
  fs.writeFileSync(
    file,
    JSON.stringify({ ok: ok === "1", consecutiveFailures: Number(failures), lastCheckedAt: ts }, null, 2) + "\n"
  );
' "$STATE_FILE" "$overall_ok" "$consecutive_failures" "$NOW_ISO"

if [[ "$overall_ok" -eq 1 ]]; then
  if [[ "$prev_failures" -ge "$FAIL_THRESHOLD" ]]; then
    notify "gateway healthcheck recovered: ${GATEWAY_URL}"
  fi
  log "ok http_status=${http_status} heartbeat_file=${HEARTBEAT_FILE_NAME} heartbeat_age_sec=${heartbeat_age_sec}"
  exit 0
fi

log "fail ${reason} consecutive_failures=${consecutive_failures}"
if [[ "$consecutive_failures" -ge "$FAIL_THRESHOLD" ]]; then
  notify "gateway healthcheck failing: ${reason} (consecutive=${consecutive_failures})"
fi
exit 0
