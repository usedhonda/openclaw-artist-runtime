#!/usr/bin/env bash
set -euo pipefail
npm run typecheck
npm test
npm run build
npm run pack:verify
npm run pack:dry-run
