#!/usr/bin/env bash
set -euo pipefail

# Re-vendor the suno-cli distributable from a local suno-kit checkout into
# vendor/suno-cli/. Run this whenever suno-kit's CLI changes so the bundled copy
# stays in sync. The vendored dist/src is what ships in the artist-runtime package
# and backs the entryPath() auto-resolution (config > env > vendor).
#
# Usage:
#   scripts/sync-suno-cli-vendor.sh [SUNO_CLI_SRC]
#
# SUNO_CLI_SRC resolution order:
#   1. first CLI argument
#   2. SUNO_CLI_SRC env var
#   3. ../../docs/suno-kit/suno-cli relative to this repo (maintainer default)

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-${SUNO_CLI_SRC:-${REPO_ROOT}/../../docs/suno-kit/suno-cli}}"
DEST="${REPO_ROOT}/vendor/suno-cli"

if [ ! -d "$SRC" ]; then
  echo "suno-cli source not found: $SRC" >&2
  echo "Pass the suno-kit/suno-cli path as arg 1 or set SUNO_CLI_SRC." >&2
  exit 1
fi

echo "Building suno-cli at $SRC"
( cd "$SRC" && npm run build )

# Guard: the vendored build MUST include the blocked_captcha (422 ->
# token_validation_failed) classification fix. Refuse to vendor a stale build.
if ! grep -rq "token_validation_failed" "$SRC/dist/src"; then
  echo "verification failed: token_validation_failed missing from built dist" >&2
  echo "(need the blocked_captcha classify fix in suno-kit main)" >&2
  exit 1
fi

echo "Vendoring dist/src into $DEST"
rm -rf "$DEST"
mkdir -p "$DEST/dist"
cp -R "$SRC/dist/src" "$DEST/dist/src"
cp "$SRC/package.json" "$DEST/package.json"
cp "$SRC/LICENSE" "$DEST/LICENSE"
if [ -f "$SRC/README.md" ]; then
  cp "$SRC/README.md" "$DEST/README.md"
fi

SRC_COMMIT="$(cd "$SRC" && git rev-parse HEAD 2>/dev/null || echo unknown)"
printf '%s\n' "$SRC_COMMIT" > "$DEST/VENDOR_COMMIT"

echo "Verifying vendored entry"
test -f "$DEST/dist/src/cli.js" || { echo "vendored cli.js missing" >&2; exit 1; }
grep -rq "token_validation_failed" "$DEST/dist/src" || { echo "vendored dist missing token_validation_failed" >&2; exit 1; }

echo "suno-cli vendored OK (source commit ${SRC_COMMIT})"
