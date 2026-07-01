import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveDefaultWorkspaceRoot, resolveRuntimeConfig } from "../src/services/runtimeConfig.js";

const ENV_KEY = "OPENCLAW_LOCAL_WORKSPACE";
const originalEnv = process.env[ENV_KEY];

function makeWorkspace(authStatus: "tested" | "unconfigured" = "tested"): string {
  const root = mkdtempSync(join(tmpdir(), "runtime-config-fallback-"));
  mkdirSync(join(root, "runtime"), { recursive: true });
  const overrides = {
    schemaVersion: 1,
    distribution: {
      enabled: false,
      platforms: {
        x: { enabled: false, authStatus, lastTestedAt: 1700000000000 }
      }
    }
  };
  writeFileSync(join(root, "runtime", "config-overrides.json"), JSON.stringify(overrides, null, 2));
  return root;
}

beforeEach(() => {
  delete process.env[ENV_KEY];
});

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = originalEnv;
  }
});

describe("resolveRuntimeConfig env-aware workspace fallback", () => {
  it("prefers OPENCLAW_LOCAL_WORKSPACE when no payload is provided", async () => {
    const workspace = makeWorkspace("tested");
    process.env[ENV_KEY] = workspace;

    const config = await resolveRuntimeConfig();
    expect(config.distribution.platforms.x.authStatus).toBe("tested");
    expect(config.distribution.platforms.x.lastTestedAt).toBe(1700000000000);
  });

  it("normalizes a relative persisted workspaceRoot to the resolved env workspace", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "runtime-config-relative-"));
    mkdirSync(join(workspace, "runtime"), { recursive: true });
    writeFileSync(
      join(workspace, "runtime", "config-overrides.json"),
      JSON.stringify({
        schemaVersion: 1,
        artist: { workspaceRoot: "." }
      })
    );
    process.env[ENV_KEY] = workspace;

    const config = await resolveRuntimeConfig();
    expect(config.artist.workspaceRoot).toBe(workspace);
  });

  it("falls back to defaultArtistRuntimeConfig workspaceRoot when env is unset", () => {
    expect(resolveDefaultWorkspaceRoot()).toBe(".local/openclaw/workspace");
  });

  it("ignores empty OPENCLAW_LOCAL_WORKSPACE", () => {
    process.env[ENV_KEY] = "   ";
    expect(resolveDefaultWorkspaceRoot()).toBe(".local/openclaw/workspace");
  });

  it("payload workspaceRoot still takes priority over env", async () => {
    const envWorkspace = makeWorkspace("unconfigured");
    const payloadWorkspace = makeWorkspace("tested");
    process.env[ENV_KEY] = envWorkspace;

    const config = await resolveRuntimeConfig({ artist: { workspaceRoot: payloadWorkspace } as never });
    expect(config.distribution.platforms.x.authStatus).toBe("tested");
  });
});
