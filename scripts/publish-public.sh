#!/usr/bin/env bash
# Bring the public repository up to date from this (private) repository.
#
#   scripts/publish-public.sh <public-checkout>            # stage a release commit
#   scripts/publish-public.sh <public-checkout> --push     # ... and publish it
#
# <public-checkout> is a persistent clone of the public repository with this
# repository's hooks installed (scripts/install-git-hooks.sh). The public history
# is a series of ordinary release commits on top of each other: never rebuilt,
# never force-pushed (branch protection forbids it anyway).
#
# Steps:
#   1. export this repository's HEAD through scripts/export-public-tree.mjs, which
#      drops the private-only operator records and refuses any identity finding;
#   2. mirror that tree onto the public checkout's working tree (files removed
#      here are removed there);
#   3. commit the difference as one release commit;
#   4. only with --push: push it, with OPENCLAW_PUBLIC_PUSH=1 for that one push,
#      through the pre-push guard (visibility, leak scan, hygiene).
set -euo pipefail

public_dir="${1:-}"
push="${2:-}"
if [ -z "${public_dir}" ] || [ ! -d "${public_dir}/.git" ]; then
  echo "usage: scripts/publish-public.sh <public-checkout> [--push]" >&2
  exit 2
fi
public_dir="$(cd "${public_dir}" && pwd)"

repo_root="$(git rev-parse --show-toplevel)"
cd "${repo_root}"
private_patterns="${repo_root}/.local/leak-patterns.json"
source_sha="$(git rev-parse --short HEAD)"

if [ -n "$(git -C "${public_dir}" status --porcelain)" ]; then
  echo "publish-public: ${public_dir} has uncommitted changes; refusing to overwrite them" >&2
  exit 1
fi
git -C "${public_dir}" pull --ff-only --quiet

export_dir="$(mktemp -d)"
trap 'rm -rf "${export_dir}"' EXIT
rmdir "${export_dir}"
node scripts/export-public-tree.mjs "${export_dir}"

rsync -a --delete --exclude ".git/" --exclude "node_modules" "${export_dir}/" "${public_dir}/"

cd "${public_dir}"
git add -A
if git diff --cached --quiet; then
  echo "publish-public: public tree already matches ${source_sha}; nothing to publish"
  exit 0
fi
OPENCLAW_LEAK_PATTERNS_FILE="${private_patterns}" git commit -q -m "Release from ${source_sha}"
echo "publish-public: staged release commit $(git rev-parse --short HEAD) from ${source_sha}"
git --no-pager diff --stat HEAD~1 HEAD | tail -1

if [ "${push}" = "--push" ]; then
  OPENCLAW_PUBLIC_PUSH=1 OPENCLAW_LEAK_PATTERNS_FILE="${private_patterns}" git push origin HEAD
else
  echo "publish-public: not pushed. Re-run with --push, or push from ${public_dir} with OPENCLAW_PUBLIC_PUSH=1."
fi
