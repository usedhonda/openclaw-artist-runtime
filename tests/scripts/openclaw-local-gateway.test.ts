import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sourceScript = resolve("scripts/openclaw-local-gateway");

async function makeFixture(options: { launchd?: "loaded" | "stopped"; supervisor?: "owner" | "exit" } = {}) {
  const root = await mkdtemp(join(tmpdir(), "artist-runtime-gateway-wrapper-test-"));
  const scripts = join(root, "scripts");
  const bin = join(root, "bin");
  const localRoot = join(root, "openclaw");
  const workspace = join(localRoot, "workspace");
  const logs = join(localRoot, "logs");
  const marker = join(root, "supervisor-started");
  await mkdir(scripts, { recursive: true });
  await mkdir(bin, { recursive: true });
  await writeFile(join(scripts, "openclaw-local-gateway"), await readFile(sourceScript, "utf8"), "utf8");
  await chmod(join(scripts, "openclaw-local-gateway"), 0o755);
  await writeFile(
    join(scripts, "openclaw-local-env.sh"),
    `#!/usr/bin/env bash
set -euo pipefail
export OPENCLAW_LOCAL_ROOT='${localRoot}'
export OPENCLAW_HOME='${join(localRoot, "home")}'
export OPENCLAW_STATE_DIR='${join(localRoot, "state")}'
export OPENCLAW_CONFIG_PATH='${join(localRoot, "config/openclaw.json")}'
export OPENCLAW_LOCAL_WORKSPACE='${workspace}'
export OPENCLAW_LOCAL_LOGS='${logs}'
export OPENCLAW_LOCAL_GATEWAY_PID='${join(logs, "gateway.pid")}'
export OPENCLAW_LOCAL_GATEWAY_LOG='${join(logs, "gateway.log")}'
export OPENCLAW_LOCAL_GATEWAY_PORT=43134
export OPENCLAW_LOCAL_GATEWAY_BIND=loopback
export OPENCLAW_LOCAL_GATEWAY_AUTH=none
export OPENCLAW_LOCAL_GATEWAY_HTTP_URL=http://127.0.0.1:43134
export OPENCLAW_LOCAL_GATEWAY_WS_URL=ws://127.0.0.1:43134
export PATH='${bin}':"\${PATH}"
`,
    "utf8"
  );
  await chmod(join(scripts, "openclaw-local-env.sh"), 0o755);
  await writeFile(
    join(scripts, "openclaw-local-gateway-supervisor"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "started" >> '${marker}'
if [[ "\${FAKE_SUPERVISOR_MODE:-owner}" == exit ]]; then exit 0; fi
lock="\${OPENCLAW_LOCAL_WORKSPACE}/runtime/gateway-supervisor.lock"
mkdir -p "$(dirname "\${lock}")"
echo "$$" > "\${lock}"
child=""
cleanup() { [[ -n "\${child}" ]] && kill "\${child}" 2>/dev/null || true; rm -f "\${lock}"; exit 0; }
trap cleanup TERM INT EXIT
sleep 30 & child=$!
wait "\${child}"
`,
    "utf8"
  );
  await chmod(join(scripts, "openclaw-local-gateway-supervisor"), 0o755);
  await writeFile(join(scripts, "openclaw-local-http-smoke.sh"), "#!/usr/bin/env bash\nexit 0\n", "utf8");
  await chmod(join(scripts, "openclaw-local-http-smoke.sh"), 0o755);
  await writeFile(
    join(bin, "launchctl"),
    `#!/usr/bin/env bash
if [[ "$1" == print && "\${FAKE_LAUNCHD_STATE:-stopped}" == loaded ]]; then
  echo 'state = running'
  if [[ -n "\${FAKE_LAUNCHD_PID:-}" ]]; then echo "pid = \${FAKE_LAUNCHD_PID}"; fi
  exit 0
fi
exit 1
`,
    "utf8"
  );
  await chmod(join(bin, "launchctl"), 0o755);

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    FAKE_LAUNCHD_STATE: options.launchd ?? "stopped",
    FAKE_SUPERVISOR_MODE: options.supervisor ?? "owner"
  };
  return { root, scripts, marker, env, supervisor: join(scripts, "openclaw-local-gateway-supervisor") };
}

function runWrapper(fixture: Awaited<ReturnType<typeof makeFixture>>, command: string) {
  return spawnSync("bash", [join(fixture.scripts, "openclaw-local-gateway"), command], {
    cwd: fixture.root,
    env: fixture.env,
    encoding: "utf8",
    timeout: 15_000
  });
}

async function startOwner(fixture: Awaited<ReturnType<typeof makeFixture>>) {
  const envScript = join(fixture.scripts, "openclaw-local-env.sh");
  const child = spawn("bash", ["-c", `source '${envScript}' && exec '${fixture.supervisor}'`], {
    cwd: fixture.root,
    env: fixture.env,
    stdio: "ignore"
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  return child;
}

describe("openclaw-local-gateway owner guards", () => {
  it("does not spawn when launchd owns the live supervisor lock", async () => {
    const fixture = await makeFixture({ launchd: "loaded" });
    const owner = await startOwner(fixture);
    fixture.env.FAKE_LAUNCHD_PID = String(owner.pid);
    const result = runWrapper(fixture, "start");
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("already running under launchd");
    expect((await readFile(fixture.marker, "utf8")).trim().split("\n")).toHaveLength(1);
    owner.kill("SIGTERM");
  });

  it("refuses manual stop while launchd is loaded without killing its owner", async () => {
    const fixture = await makeFixture({ launchd: "loaded" });
    const owner = await startOwner(fixture);
    fixture.env.FAKE_LAUNCHD_PID = String(owner.pid);
    const result = runWrapper(fixture, "stop");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("refusing manual stop");
    expect(() => process.kill(owner.pid!, 0)).not.toThrow();
    owner.kill("SIGTERM");
  });

  it("fails when a spawned contender exits even if the foreign listener smoke passes", async () => {
    const fixture = await makeFixture({ supervisor: "exit" });
    const result = runWrapper(fixture, "start");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("failed to stay up");
    expect(result.stdout).not.toContain("Gateway started");
  });

  it("starts and stops an ordinary manual owner", async () => {
    const fixture = await makeFixture();
    const started = runWrapper(fixture, "start");
    expect(started.status).toBe(0);
    expect(started.stdout).toContain("Gateway started");
    const config = JSON.parse(await readFile(join(fixture.root, "openclaw/config/openclaw.json"), "utf8"));
    expect(config.channels.telegram.streaming).toEqual({
      mode: "partial",
      preview: { toolProgress: false }
    });
    expect(config.messages.visibleReplies).toBe("automatic");
    expect(config.tools.deny).toEqual(
      expect.arrayContaining(["group:runtime", "write", "edit", "apply_patch", "gateway"])
    );
    const stopped = runWrapper(fixture, "stop");
    expect(stopped.status).toBe(0);
    expect(stopped.stdout).toContain("Gateway stopped");
  });
});
