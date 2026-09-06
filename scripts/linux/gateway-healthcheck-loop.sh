#!/usr/bin/env bash
# Runs scripts/linux/gateway-healthcheck.sh on a fixed interval as a
# detached, singleton background loop. For a Linux host with no systemd/cron
# available to schedule it (for example, a container whose PID 1 is not
# systemd) — see openclaw-artist-healthcheck.timer.template for the
# systemd-managed alternative. Mirrors the singleton pid-file lock and
# perl-setsid detach conventions of scripts/openclaw-local-gateway.
set -euo pipefail

# Named "loop_self_dir", not "script_dir": openclaw-local-env.sh below
# defines its own unprefixed "script_dir" at source time, and sourcing (as
# opposed to executing) it in this shell would silently clobber a same-named
# variable here.
loop_self_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${loop_self_dir}/../.." && pwd)"

# shellcheck source=/dev/null
source "${repo_root}/scripts/openclaw-local-env.sh"

HEALTHCHECK_SCRIPT="${loop_self_dir}/gateway-healthcheck.sh"
HEALTHCHECK_INTERVAL_SEC="${HEALTHCHECK_INTERVAL_SEC:-300}"
# Directory for this loop's own pid file and log. Defaults to the shared
# OPENCLAW_LOCAL_LOGS dir but stays independently overridable:
# openclaw-local-env.sh assigns OPENCLAW_LOCAL_LOGS unconditionally (no
# "${VAR:-default}" guard), so it cannot itself be overridden by a
# caller-set environment variable.
HEALTHCHECK_LOOP_LOG_DIR="${HEALTHCHECK_LOOP_LOG_DIR:-${OPENCLAW_LOCAL_LOGS}}"
LOOP_PID_FILE="${HEALTHCHECK_LOOP_LOG_DIR}/healthcheck-loop.pid"
LOOP_LOG_FILE="${HEALTHCHECK_LOOP_LOG_DIR}/healthcheck.log"

export WORKSPACE_ROOT="${WORKSPACE_ROOT:-${OPENCLAW_LOCAL_WORKSPACE}}"
export GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:${OPENCLAW_LOCAL_GATEWAY_PORT}/plugins/artist-runtime/api/status}"

command="${1:-status}"
if [[ $# -gt 0 ]]; then
  shift
fi

loop_pid_is_live() {
  local pid="$1"
  [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null
}

read_loop_pid() {
  if [[ -f "${LOOP_PID_FILE}" ]]; then
    tr -d '[:space:]' < "${LOOP_PID_FILE}"
  fi
}

cleanup_stale_pid() {
  local pid
  pid="$(read_loop_pid)"
  if [[ -n "${pid}" ]] && ! loop_pid_is_live "${pid}"; then
    rm -f "${LOOP_PID_FILE}"
  fi
}

case "${command}" in
  run-once)
    exec "${HEALTHCHECK_SCRIPT}"
    ;;
  start)
    mkdir -p "${HEALTHCHECK_LOOP_LOG_DIR}"
    cleanup_stale_pid
    existing_pid="$(read_loop_pid)"
    if loop_pid_is_live "${existing_pid:-}"; then
      echo "Healthcheck loop already running (pid ${existing_pid})." >&2
      exit 0
    fi
    : > "${LOOP_LOG_FILE}"
    nohup perl -MPOSIX=setsid -e 'setsid() or die "setsid failed: $!"; exec @ARGV or die "exec failed: $!"' \
      bash -c '
        healthcheck_script="$1"; log_file="$2"; interval="$3"
        while true; do
          "${healthcheck_script}" >>"${log_file}" 2>&1
          sleep "${interval}"
        done
      ' _ "${HEALTHCHECK_SCRIPT}" "${LOOP_LOG_FILE}" "${HEALTHCHECK_INTERVAL_SEC}" \
      >>"${LOOP_LOG_FILE}" 2>&1 < /dev/null &
    loop_pid=$!
    disown "${loop_pid}" 2>/dev/null || true
    echo "${loop_pid}" > "${LOOP_PID_FILE}"
    echo "Healthcheck loop started (pid ${loop_pid}), interval ${HEALTHCHECK_INTERVAL_SEC}s."
    echo "Log: ${LOOP_LOG_FILE}"
    ;;
  stop)
    cleanup_stale_pid
    existing_pid="$(read_loop_pid)"
    if [[ -z "${existing_pid}" ]]; then
      echo "Healthcheck loop is not running."
      exit 0
    fi
    kill "${existing_pid}" 2>/dev/null || true
    for _ in $(seq 1 10); do
      if ! loop_pid_is_live "${existing_pid}"; then
        rm -f "${LOOP_PID_FILE}"
        echo "Healthcheck loop stopped."
        exit 0
      fi
      sleep 1
    done
    kill -9 "${existing_pid}" 2>/dev/null || true
    rm -f "${LOOP_PID_FILE}"
    echo "Healthcheck loop force-stopped."
    ;;
  status)
    cleanup_stale_pid
    existing_pid="$(read_loop_pid)"
    last_log_line=""
    if [[ -f "${LOOP_LOG_FILE}" ]]; then
      last_log_line="$(tail -n 1 "${LOOP_LOG_FILE}" 2>/dev/null || true)"
    fi
    if loop_pid_is_live "${existing_pid:-}"; then
      echo "pid=${existing_pid}"
      echo "alive=true"
    else
      echo "pid=stopped"
      echo "alive=false"
    fi
    echo "log=${LOOP_LOG_FILE}"
    echo "last_log_line=${last_log_line}"
    ;;
  *)
    echo "Usage: scripts/linux/gateway-healthcheck-loop.sh [start|stop|status|run-once]" >&2
    exit 1
    ;;
esac
