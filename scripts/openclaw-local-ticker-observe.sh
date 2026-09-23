#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "${script_dir}/openclaw-local-env.sh"

base_url="${OPENCLAW_LOCAL_GATEWAY_HTTP_URL}"
config_endpoint="${base_url}/plugins/artist-runtime/api/config"
config_update_endpoint="${base_url}/plugins/artist-runtime/api/config/update"
status_endpoint="${base_url}/plugins/artist-runtime/api/status"
run_cycle_endpoint="${base_url}/plugins/artist-runtime/api/run-cycle"

started_gateway=0
tmp_dir="$(mktemp -d)"
original_config_json="${tmp_dir}/original-config.json"
patched_config_json="${tmp_dir}/patched-config.json"
before_status_json="${tmp_dir}/status-before.json"
after_status_json="${tmp_dir}/status-after.json"
run_cycle_response_json="${tmp_dir}/run-cycle-response.json"

cleanup() {
  if [[ -f "${original_config_json}" ]]; then
    restore_patch="$(
      node - "${original_config_json}" <<'EOF'
const fs = require("node:fs");
const configPath = process.argv[2];
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const patch = {
  autopilot: {
    enabled: config.autopilot?.enabled ?? false,
    dryRun: config.autopilot?.dryRun ?? true,
    songsPerWeek: config.autopilot?.songsPerWeek ?? 3,
    cycleIntervalMinutes: config.autopilot?.cycleIntervalMinutes ?? 180
  },
  distribution: {
    platforms: {
      x: { enabled: Boolean(config.distribution?.platforms?.x?.enabled) },
      instagram: { enabled: Boolean(config.distribution?.platforms?.instagram?.enabled) },
      tiktok: { enabled: Boolean(config.distribution?.platforms?.tiktok?.enabled) }
    }
  }
};
process.stdout.write(JSON.stringify({ patch }));
EOF
    )"
    curl -fsS -X POST "${config_update_endpoint}" \
      -H "content-type: application/json" \
      --data "${restore_patch}" >/dev/null || true
  fi

  if [[ "${started_gateway}" -eq 1 ]]; then
    "${script_dir}/openclaw-local-gateway" stop >/dev/null 2>&1 || true
  fi

  rm -rf "${tmp_dir}"
}

trap cleanup EXIT

if ! "${script_dir}/openclaw-local-http-smoke.sh" >/dev/null 2>&1; then
  "${script_dir}/openclaw-local-gateway" start >/dev/null
  started_gateway=1
fi

curl -fsS "${config_endpoint}" > "${original_config_json}"

observation_patch="$(
  node <<'EOF'
const patch = {
  patch: {
    autopilot: {
      enabled: true,
      dryRun: true,
      cycleIntervalMinutes: 15
    }
  }
};
process.stdout.write(JSON.stringify(patch));
EOF
)"

curl -fsS -X POST "${config_update_endpoint}" \
  -H "content-type: application/json" \
  --data "${observation_patch}" > "${patched_config_json}"
curl -fsS "${config_endpoint}" > "${patched_config_json}"

curl -fsS "${status_endpoint}" > "${before_status_json}"

echo "== ticker before =="
node - "${before_status_json}" <<'EOF'
const fs = require("node:fs");
const path = process.argv[2];
const status = JSON.parse(fs.readFileSync(path, "utf8"));
console.log(`lastOutcome=${status.ticker?.lastOutcome ?? "never"}`);
console.log(`lastTickAt=${status.ticker?.lastTickAt ?? "unset"}`);
console.log(`intervalMs=${status.ticker?.intervalMs ?? "unknown"}`);
console.log(`autopilotStage=${status.autopilot?.stage ?? "unknown"}`);
EOF

echo
echo "== config after temporary patch =="
node - "${patched_config_json}" <<'EOF'
const fs = require("node:fs");
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
console.log(`autopilot.enabled=${config.autopilot?.enabled}`);
console.log(`autopilot.dryRun=${config.autopilot?.dryRun}`);
console.log(`autopilot.songsPerWeek=${config.autopilot?.songsPerWeek}`);
console.log(`autopilot.cycleIntervalMinutes=${config.autopilot?.cycleIntervalMinutes}`);
EOF

curl -fsS -X POST "${run_cycle_endpoint}" \
  -H "content-type: application/json" \
  --data "$(node - "${patched_config_json}" <<'EOF'
const fs = require("node:fs");
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
process.stdout.write(JSON.stringify({ config }));
EOF
)" > "${run_cycle_response_json}"

for _ in 1 2 3; do
  sleep 1
  curl -fsS "${status_endpoint}" > "${after_status_json}"
  if node - "${before_status_json}" "${after_status_json}" <<'EOF'
const fs = require("node:fs");
const before = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const after = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const changed = before.ticker?.lastTickAt !== after.ticker?.lastTickAt
  || before.ticker?.lastOutcome !== after.ticker?.lastOutcome
  || before.autopilot?.stage !== after.autopilot?.stage
  || before.autopilot?.currentRunId !== after.autopilot?.currentRunId;
process.exit(changed ? 0 : 1);
EOF
  then
    break
  fi
done

echo
echo "== ticker after manual run-cycle =="
node - "${after_status_json}" <<'EOF'
const fs = require("node:fs");
const path = process.argv[2];
const status = JSON.parse(fs.readFileSync(path, "utf8"));
console.log(`lastOutcome=${status.ticker?.lastOutcome ?? "never"}`);
console.log(`lastTickAt=${status.ticker?.lastTickAt ?? "unset"}`);
console.log(`intervalMs=${status.ticker?.intervalMs ?? "unknown"}`);
console.log(`autopilotStage=${status.autopilot?.stage ?? "unknown"}`);
EOF

echo
echo "== manual run-cycle response =="
node - "${run_cycle_response_json}" <<'EOF'
const fs = require("node:fs");
const path = process.argv[2];
const result = JSON.parse(fs.readFileSync(path, "utf8"));
console.log(`stage=${result.stage ?? "unknown"}`);
console.log(`currentRunId=${result.currentRunId ?? "none"}`);
console.log(`currentSongId=${result.currentSongId ?? "none"}`);
console.log(`nextAction=${result.nextAction ?? "none"}`);
EOF

if node - "${before_status_json}" "${after_status_json}" <<'EOF'
const fs = require("node:fs");
const before = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const after = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const tickerChanged = before.ticker?.lastTickAt !== after.ticker?.lastTickAt
  || before.ticker?.lastOutcome !== after.ticker?.lastOutcome;
const runCycleObserved = before.autopilot?.stage !== after.autopilot?.stage
  || before.autopilot?.currentRunId !== after.autopilot?.currentRunId;
if (tickerChanged) {
  console.log("observation=ticker-updated");
  process.exit(0);
}
if (runCycleObserved) {
  console.log("observation=manual-run-cycle-proxy");
  process.exit(0);
}
process.exit(1);
EOF
then
  echo
  echo "ticker observation passed"
  exit 0
fi

if node - "${run_cycle_response_json}" <<'EOF'
const fs = require("node:fs");
const result = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const progressed = typeof result.stage === "string" && result.stage !== "idle";
process.exit(progressed ? 0 : 1);
EOF
then
  echo
  echo "ticker observation passed via manual run-cycle proxy"
  exit 0
fi

echo
echo "ticker or manual run-cycle state did not change during observation window" >&2
exit 1
