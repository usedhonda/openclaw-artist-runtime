#!/usr/bin/env bash
# Install / remove / inspect the launchd LaunchAgent that keeps the repo-local
# OpenClaw gateway supervisor alive at login and auto-restarts it on death.
#
# This is a gui-domain LaunchAgent (per-user, no sudo, no LaunchDaemon). It runs
# scripts/openclaw-local-gateway-supervisor directly so the supervisor is
# launchd's foreground child; see the .plist.template header for why.
#
# Machine-specific values (repo root, $HOME, node's bin dir) are resolved here at
# runtime, so the tracked template + this script carry no absolute machine paths.
#
# Usage:
#   scripts/openclaw-gateway-launchd.sh install     # generate plist + load + start
#   scripts/openclaw-gateway-launchd.sh uninstall   # stop + unload + remove plist
#   scripts/openclaw-gateway-launchd.sh restart     # kickstart -k (force restart)
#   scripts/openclaw-gateway-launchd.sh status      # launchctl print + health hint
#   scripts/openclaw-gateway-launchd.sh generate    # render plist only (no load)
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

label="com.openclaw.artist-runtime.gateway"
supervisor_path="${script_dir}/openclaw-local-gateway-supervisor"
template_path="${script_dir}/openclaw-gateway-launchd.plist.template"
plist_path="${HOME}/Library/LaunchAgents/${label}.plist"
log_dir="${repo_root}/.local/openclaw/logs"
stdout_path="${log_dir}/gateway.launchd.out.log"
stderr_path="${log_dir}/gateway.launchd.err.log"
gui_domain="gui/$(id -u)"
service_target="${gui_domain}/${label}"

resolve_node_bin_dir() {
  local node_path
  node_path="$(command -v node || true)"
  if [[ -z "${node_path}" ]]; then
    echo "node not found on PATH; install node or fix PATH before generating the plist" >&2
    exit 1
  fi
  cd "$(dirname "${node_path}")" && pwd
}

generate_plist() {
  if [[ ! -f "${template_path}" ]]; then
    echo "template missing: ${template_path}" >&2
    exit 1
  fi
  if [[ ! -x "${supervisor_path}" ]]; then
    echo "supervisor not executable: ${supervisor_path}" >&2
    exit 1
  fi
  local node_bin_dir
  node_bin_dir="$(resolve_node_bin_dir)"
  mkdir -p "${log_dir}" "$(dirname "${plist_path}")"
  # sed with a non-slash delimiter so absolute paths substitute cleanly.
  sed \
    -e "s|__LABEL__|${label}|g" \
    -e "s|__SUPERVISOR_PATH__|${supervisor_path}|g" \
    -e "s|__NODE_BIN_DIR__|${node_bin_dir}|g" \
    -e "s|__REPO_ROOT__|${repo_root}|g" \
    -e "s|__STDOUT_PATH__|${stdout_path}|g" \
    -e "s|__STDERR_PATH__|${stderr_path}|g" \
    "${template_path}" > "${plist_path}"
  echo "Wrote ${plist_path}"
  echo "  supervisor : ${supervisor_path}"
  echo "  node bin   : ${node_bin_dir}"
  echo "  stdout/err : ${stdout_path} / ${stderr_path}"
}

is_loaded() {
  launchctl print "${service_target}" >/dev/null 2>&1
}

cmd_install() {
  generate_plist
  # Idempotent load: bootout an existing instance first (ignore if absent), then
  # bootstrap the fresh plist. RunAtLoad starts it; kickstart guarantees a start
  # even if launchd considered it already running.
  if is_loaded; then
    echo "Service already loaded; booting it out to reload the new plist."
    launchctl bootout "${gui_domain}" "${plist_path}" 2>/dev/null || true
  fi
  launchctl bootstrap "${gui_domain}" "${plist_path}"
  launchctl kickstart -k "${service_target}" 2>/dev/null || launchctl kickstart "${service_target}" 2>/dev/null || true
  echo "Loaded and started ${service_target}"
  echo "Check: scripts/openclaw-local-gateway health"
}

cmd_uninstall() {
  if is_loaded; then
    launchctl bootout "${gui_domain}" "${plist_path}" 2>/dev/null || \
      launchctl bootout "${service_target}" 2>/dev/null || true
    echo "Booted out ${service_target}"
  else
    echo "Service not loaded; nothing to boot out."
  fi
  if [[ -f "${plist_path}" ]]; then
    rm -f "${plist_path}"
    echo "Removed ${plist_path}"
  fi
  echo "Gateway is no longer launchd-managed. Use scripts/openclaw-local-gateway start to run it manually."
}

cmd_restart() {
  if ! is_loaded; then
    echo "Service not loaded. Run: $0 install" >&2
    exit 1
  fi
  launchctl kickstart -k "${service_target}"
  echo "Restarted ${service_target}"
}

cmd_status() {
  echo "Label        : ${label}"
  echo "Plist        : ${plist_path}"
  echo "ServiceTarget: ${service_target}"
  if is_loaded; then
    echo "Loaded       : yes"
    launchctl print "${service_target}" 2>/dev/null | grep -E "state =|pid =|last exit code =|program =" || true
  else
    echo "Loaded       : no"
  fi
}

case "${1:-status}" in
  install) cmd_install ;;
  uninstall) cmd_uninstall ;;
  restart) cmd_restart ;;
  generate) generate_plist ;;
  status) cmd_status ;;
  *)
    echo "Usage: $0 [install|uninstall|restart|generate|status]" >&2
    exit 1
    ;;
esac
