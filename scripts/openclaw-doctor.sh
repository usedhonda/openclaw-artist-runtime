#!/usr/bin/env bash
set -euo pipefail

ROOT="."
JSON=0
STATUS_URL=""
GATEWAY_LOG=""
GATEWAY_HEALTH_JSON=""
STALE_DAYS="${OPENCLAW_DOCTOR_PROFILE_STALE_DAYS:-30}"
DISK_WARN_GB="${OPENCLAW_DOCTOR_DISK_WARN_GB:-10}"
DISK_FAIL_GB="${OPENCLAW_DOCTOR_DISK_FAIL_GB:-50}"
GATEWAY_LOG_LINES="${OPENCLAW_DOCTOR_GATEWAY_LOG_LINES:-240}"
STATUS_PROBE_TIMEOUT="${OPENCLAW_DOCTOR_STATUS_TIMEOUT:-5}"
STATUS_PROBE_ATTEMPTS="${OPENCLAW_DOCTOR_STATUS_ATTEMPTS:-3}"

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
    --json)
      JSON=1
      shift
      ;;
    --status-url)
      STATUS_URL="${2:-}"
      [[ -n "$STATUS_URL" ]] || {
        echo "--status-url requires a URL" >&2
        exit 1
      }
      shift 2
      ;;
    --gateway-log)
      GATEWAY_LOG="${2:-}"
      [[ -n "$GATEWAY_LOG" ]] || {
        echo "--gateway-log requires a path" >&2
        exit 1
      }
      shift 2
      ;;
    --gateway-health-json)
      GATEWAY_HEALTH_JSON="${2:-}"
      [[ -n "$GATEWAY_HEALTH_JSON" ]] || {
        echo "--gateway-health-json requires a path" >&2
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

PORT="${OPENCLAW_GATEWAY_PORT:-${OPENCLAW_LOCAL_GATEWAY_PORT:-43134}}"
if [[ -z "$STATUS_URL" ]]; then
  STATUS_URL="http://127.0.0.1:${PORT}/plugins/artist-runtime/api/status"
fi
if [[ -z "$GATEWAY_LOG" ]]; then
  GATEWAY_LOG="${ROOT%/}/.local/openclaw/logs/gateway.log"
fi

OK_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0
CHECK_COUNT=0

json_string() {
  node -e 'process.stdout.write(JSON.stringify(process.argv[1] || ""))' "$1"
}

record_check() {
  name="$1"
  status="$2"
  detail="$3"

  case "$status" in
    ok) OK_COUNT=$((OK_COUNT + 1)) ;;
    warn) WARN_COUNT=$((WARN_COUNT + 1)) ;;
    fail) FAIL_COUNT=$((FAIL_COUNT + 1)) ;;
    *)
      echo "invalid status: $status" >&2
      exit 1
      ;;
  esac

  if [[ "$JSON" -eq 1 ]]; then
    [[ "$CHECK_COUNT" -gt 0 ]] && printf ','
    printf '{"name":%s,"status":%s,"detail":%s}' "$(json_string "$name")" "$(json_string "$status")" "$(json_string "$detail")"
  else
    printf '%-18s %-5s %s\n' "$name" "$status" "$detail"
  fi
  CHECK_COUNT=$((CHECK_COUNT + 1))
}

read_json_field() {
  file="$1"
  expr="$2"
  node -e '
const fs = require("node:fs");
const file = process.argv[1];
const expr = process.argv[2];
try {
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  const result = expr.split(".").reduce((current, key) => current == null ? undefined : current[key], value);
  if (result !== undefined) process.stdout.write(String(result));
} catch {
  process.exit(2);
}
' "$file" "$expr"
}

read_gateway_health_payload() {
  if [[ -n "$GATEWAY_HEALTH_JSON" ]]; then
    [[ -f "$GATEWAY_HEALTH_JSON" ]] && cat "$GATEWAY_HEALTH_JSON"
    return
  fi
  local script_dir
  script_dir="$(cd "$(dirname "$0")" && pwd)"
  if [[ -x "${script_dir}/openclaw-local-gateway" ]]; then
    "${script_dir}/openclaw-local-gateway" health 2>/dev/null || true
  fi
}

probe_status_endpoint() {
  local attempt=1
  while [[ "$attempt" -le "$STATUS_PROBE_ATTEMPTS" ]]; do
    if curl -fsS --max-time "$STATUS_PROBE_TIMEOUT" "$STATUS_URL" >/dev/null 2>&1; then
      return 0
    fi
    attempt=$((attempt + 1))
    [[ "$attempt" -le "$STATUS_PROBE_ATTEMPTS" ]] && sleep 1
  done
  return 1
}

if [[ "$JSON" -eq 1 ]]; then
  printf '{"checks":['
fi

if command -v curl >/dev/null 2>&1; then
  if probe_status_endpoint; then
    record_check "gateway" "ok" "gateway status endpoint responded"
  else
    record_check "gateway" "fail" "gateway status endpoint did not respond after ${STATUS_PROBE_ATTEMPTS} attempts: $STATUS_URL"
  fi
else
  record_check "gateway" "warn" "curl is not available; skipped gateway status probe"
fi

GATEWAY_HEALTH_PAYLOAD="$(read_gateway_health_payload)"
if [[ -n "$GATEWAY_HEALTH_PAYLOAD" ]]; then
  TELEGRAM_TRANSPORT="$(printf '%s' "$GATEWAY_HEALTH_PAYLOAD" | node -e '
const fs = require("node:fs");
try {
  const health = JSON.parse(fs.readFileSync(0, "utf8"));
  const channel = health.channels?.telegram;
  const account = channel?.accounts?.default ?? channel;
  if (!account) {
    console.log("warn\ttelegram channel missing in gateway health");
    process.exit(0);
  }
  const issues = [];
  if (account.enabled !== true) issues.push("enabled=false");
  if (account.configured !== true) issues.push("configured=false");
  if (account.running !== true) issues.push("running=false");
  if (account.connected !== true) issues.push("connected=false");
  if (account.tokenStatus && account.tokenStatus !== "available") issues.push(`tokenStatus=${account.tokenStatus}`);
  if (account.lastError) issues.push(`lastError=${account.lastError}`);
  if (issues.length > 0) {
    console.log(`fail\tTelegram transport not ready: ${issues.join(", ")}`);
    process.exit(0);
  }
  console.log("ok\tTelegram transport ready (running=true, connected=true)");
} catch {
  console.log("warn\tgateway health JSON could not be parsed; skipped Telegram transport check");
}
' 2>/dev/null || true)"
  if [[ -n "$TELEGRAM_TRANSPORT" ]]; then
    IFS=$'\t' read -r TELEGRAM_TRANSPORT_STATUS TELEGRAM_TRANSPORT_DETAIL <<< "$TELEGRAM_TRANSPORT"
    record_check "telegram_transport" "$TELEGRAM_TRANSPORT_STATUS" "$TELEGRAM_TRANSPORT_DETAIL"
  else
    record_check "telegram_transport" "warn" "gateway health did not produce a Telegram transport result"
  fi
else
  record_check "telegram_transport" "warn" "gateway health unavailable; skipped Telegram transport check"
fi

REQUIRED_TELEGRAM_COMMANDS=(suno lyrics plan take draft)
if [[ -f "$GATEWAY_LOG" ]]; then
  RECENT_GATEWAY_LOG="$(tail -n "$GATEWAY_LOG_LINES" "$GATEWAY_LOG" 2>/dev/null || true)"
  MISSING_TELEGRAM_COMMANDS=()
  for command_name in "${REQUIRED_TELEGRAM_COMMANDS[@]}"; do
    if ! printf '%s\n' "$RECENT_GATEWAY_LOG" | grep -F "[artist-runtime] registered runtime-slash command: ${command_name}" >/dev/null; then
      MISSING_TELEGRAM_COMMANDS+=("$command_name")
    fi
  done
  if [[ "${#MISSING_TELEGRAM_COMMANDS[@]}" -eq 0 ]]; then
    record_check "telegram_commands" "ok" "fallback text commands registered: ${REQUIRED_TELEGRAM_COMMANDS[*]}"
  else
    record_check "telegram_commands" "fail" "missing fallback command registrations in recent gateway log: ${MISSING_TELEGRAM_COMMANDS[*]}"
  fi
else
  record_check "telegram_commands" "warn" "gateway log not found; skipped fallback command registration check: $GATEWAY_LOG"
fi

CONFIG_PATH="${ROOT%/}/runtime/config-overrides.json"
if [[ -f "$CONFIG_PATH" ]]; then
  X_STATUS="$(read_json_field "$CONFIG_PATH" "distribution.platforms.x.authStatus" 2>/dev/null || true)"
  if [[ "$X_STATUS" == "tested" ]]; then
    record_check "x_probe" "ok" "X authStatus is tested"
  elif [[ "$X_STATUS" == "failed" ]]; then
    record_check "x_probe" "fail" "X authStatus is failed"
  elif [[ -n "$X_STATUS" ]]; then
    record_check "x_probe" "warn" "X authStatus is $X_STATUS"
  else
    record_check "x_probe" "warn" "X authStatus is not recorded"
  fi
else
  record_check "x_probe" "warn" "runtime config overrides not found"
fi

BUDGET_PATH="${ROOT%/}/runtime/suno/budget.json"
if [[ -f "$BUDGET_PATH" ]]; then
  BUDGET_SUMMARY="$(node -e '
const fs = require("node:fs");
try {
  const budget = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const consumed = Number.isFinite(Number(budget.consumed)) ? Number(budget.consumed) : 0;
  const limit = Number.isFinite(Number(budget.limit)) && Number(budget.limit) > 0 ? Number(budget.limit) : 60;
  const remaining = Math.max(0, limit - consumed);
  process.stdout.write(`${consumed}:${limit}:${remaining}`);
} catch {
  process.exit(2);
}
' "$BUDGET_PATH" 2>/dev/null || true)"
  if [[ -z "$BUDGET_SUMMARY" ]]; then
    record_check "suno_budget" "fail" "budget.json could not be parsed"
  else
    CONSUMED="$(printf '%s' "$BUDGET_SUMMARY" | awk -F: '{print $1}')"
    LIMIT="$(printf '%s' "$BUDGET_SUMMARY" | awk -F: '{print $2}')"
    REMAINING="$(printf '%s' "$BUDGET_SUMMARY" | awk -F: '{print $3}')"
    if [[ "$REMAINING" -le 0 ]]; then
      record_check "suno_budget" "fail" "Suno budget exhausted (${CONSUMED}/${LIMIT})"
    elif [[ $((REMAINING * 5)) -le "$LIMIT" ]]; then
      record_check "suno_budget" "warn" "Suno budget low (${CONSUMED}/${LIMIT}, remaining ${REMAINING})"
    else
      record_check "suno_budget" "ok" "Suno budget available (${CONSUMED}/${LIMIT}, remaining ${REMAINING})"
    fi
  fi
else
  record_check "suno_budget" "warn" "budget.json not found; tracker will initialize on first use"
fi

RUNTIME_DIR="${ROOT%/}/runtime"
if [[ -d "$RUNTIME_DIR" ]]; then
  RUNTIME_KB="$(du -sk "$RUNTIME_DIR" 2>/dev/null | awk '{print $1}')"
  WARN_KB=$((DISK_WARN_GB * 1024 * 1024))
  FAIL_KB=$((DISK_FAIL_GB * 1024 * 1024))
  if [[ "$RUNTIME_KB" -ge "$FAIL_KB" ]]; then
    record_check "disk_usage" "fail" "runtime uses ${RUNTIME_KB} KB, above fail threshold ${DISK_FAIL_GB} GB"
  elif [[ "$RUNTIME_KB" -ge "$WARN_KB" ]]; then
    record_check "disk_usage" "warn" "runtime uses ${RUNTIME_KB} KB, above warn threshold ${DISK_WARN_GB} GB"
  else
    record_check "disk_usage" "ok" "runtime uses ${RUNTIME_KB} KB"
  fi
else
  record_check "disk_usage" "warn" "runtime directory not found"
fi

PROFILE_DIR="${ROOT%/}/.openclaw-browser-profiles/suno"
if [[ -d "$PROFILE_DIR" ]]; then
  LATEST_EPOCH="$(node -e '
const fs = require("node:fs");
const path = require("node:path");
function latest(target) {
  let max = 0;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) {
      max = Math.max(max, latest(child));
    } else {
      max = Math.max(max, Math.floor(fs.statSync(child).mtimeMs / 1000));
    }
  }
  return max;
}
try {
  const value = latest(process.argv[1]);
  if (value > 0) process.stdout.write(String(value));
} catch {
  process.exit(2);
}
' "$PROFILE_DIR" 2>/dev/null || true)"
  if [[ -z "$LATEST_EPOCH" ]]; then
    record_check "suno_profile" "fail" "Suno profile exists but has no readable files"
  else
    NOW_EPOCH="$(date -u +%s)"
    AGE_DAYS=$(((NOW_EPOCH - LATEST_EPOCH) / 86400))
    if [[ "$AGE_DAYS" -gt "$STALE_DAYS" ]]; then
      record_check "suno_profile" "warn" "Suno profile latest file is ${AGE_DAYS} days old"
    else
      record_check "suno_profile" "ok" "Suno profile latest file is ${AGE_DAYS} days old"
    fi
  fi
else
  record_check "suno_profile" "fail" "Suno profile directory not found"
fi

if [[ "$JSON" -eq 1 ]]; then
  printf '],"summary":{"ok":%s,"warn":%s,"fail":%s}}\n' "$OK_COUNT" "$WARN_COUNT" "$FAIL_COUNT"
fi

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  exit 2
fi
if [[ "$WARN_COUNT" -gt 0 ]]; then
  exit 1
fi
exit 0
