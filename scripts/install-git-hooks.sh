#!/usr/bin/env bash
# Point this checkout's git hooks at the tracked hooks in scripts/hooks.
#
# Hooks are not cloned, so every checkout has to opt in once. Using
# core.hooksPath (rather than copying into .git/hooks) means the hooks stay
# tracked and reviewable, and an update to them takes effect without reinstalling.
#
#   scripts/install-git-hooks.sh            # install
#   scripts/install-git-hooks.sh --status   # show what is configured
#   scripts/install-git-hooks.sh --uninstall
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "${repo_root}"
hooks_path="scripts/hooks"

case "${1:-install}" in
  --status|status)
    configured="$(git config --local --get core.hooksPath || true)"
    if [ "${configured}" = "${hooks_path}" ]; then
      echo "git hooks: installed (core.hooksPath=${configured})"
    elif [ -n "${configured}" ]; then
      echo "git hooks: core.hooksPath=${configured} (not this repository's tracked hooks)"
    else
      echo "git hooks: not installed"
    fi
    ;;
  --uninstall|uninstall)
    git config --local --unset core.hooksPath || true
    echo "git hooks: uninstalled"
    ;;
  install)
    chmod +x "${hooks_path}"/*
    git config --local core.hooksPath "${hooks_path}"
    echo "git hooks: installed (core.hooksPath=${hooks_path})"
    echo "  pre-commit  scans staged files for operator-specific content"
    echo "  pre-push    scans the distribution surface and the tracked surface"
    ;;
  *)
    echo "usage: scripts/install-git-hooks.sh [install|--status|--uninstall]" >&2
    exit 2
    ;;
esac
