import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// Source the real launcher env script from a throwaway repo root so no .local
// overlay or credentials file on the developer machine leaks into the derivation.
const roots: string[] = [];

async function deriveGatewayUrls(env: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "openclaw-local-env-"));
  roots.push(root);
  await mkdir(join(root, "scripts"), { recursive: true });
  const script = join(root, "scripts", "openclaw-local-env.sh");
  await copyFile(resolve("scripts/openclaw-local-env.sh"), script);
  const result = spawnSync(
    "bash",
    ["-c", `source '${script}' && printf '%s\\n%s\\n%s\\n' "$OPENCLAW_LOCAL_GATEWAY_BIND" "$OPENCLAW_LOCAL_GATEWAY_HTTP_URL" "$OPENCLAW_LOCAL_GATEWAY_WS_URL"`],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: root,
        OPENCLAW_TAILSCALE_IP: "100.64.0.9",
        OPENCLAW_LOCAL_GATEWAY_PORT: "19001",
        ...env
      },
      timeout: 15_000
    }
  );
  expect(result.status, result.stderr).toBe(0);
  const [bind, httpUrl, wsUrl] = result.stdout.trim().split("\n");
  return { bind, httpUrl, wsUrl };
}

async function deriveVar(name: string, env: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "openclaw-local-env-"));
  roots.push(root);
  await mkdir(join(root, "scripts"), { recursive: true });
  const script = join(root, "scripts", "openclaw-local-env.sh");
  await copyFile(resolve("scripts/openclaw-local-env.sh"), script);
  const result = spawnSync("bash", ["-c", `source '${script}' && printf '%s' "\${${name}}"`], {
    cwd: root,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: root, OPENCLAW_TAILSCALE_IP: "100.64.0.9", ...env },
    timeout: 15_000
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("openclaw-local-env gateway URL derivation", () => {
  it("points in-box probes at 127.0.0.1 when the gateway is bound to loopback on a tailnet host", async () => {
    const derived = await deriveGatewayUrls({ OPENCLAW_LOCAL_GATEWAY_BIND: "loopback" });
    expect(derived.bind).toBe("loopback");
    expect(derived.httpUrl).toBe("http://127.0.0.1:19001");
    expect(derived.wsUrl).toBe("ws://127.0.0.1:19001");
  });

  it("keeps the tailnet host in the URLs when the gateway is bound to the tailnet", async () => {
    const derived = await deriveGatewayUrls({});
    expect(derived.bind).toBe("tailnet");
    expect(derived.httpUrl).toBe("http://100.64.0.9:19001");
    expect(derived.wsUrl).toBe("ws://100.64.0.9:19001");
  });
});

describe("operator overrides", () => {
  it("lets the environment turn the song spawn proposer off", async () => {
    await expect(deriveVar("OPENCLAW_SONG_SPAWN_ENABLED", {})).resolves.toBe("on");
    await expect(deriveVar("OPENCLAW_SONG_SPAWN_ENABLED", { OPENCLAW_SONG_SPAWN_ENABLED: "off" })).resolves.toBe("off");
  });
});
