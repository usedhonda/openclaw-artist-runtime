import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultArtistRuntimeConfig } from "../src/config/defaultConfig.js";
import { resolveDefaultWorkspaceRoot, resolveRuntimeConfig } from "../src/services/runtimeConfig.js";

const ENV_KEY = "OPENCLAW_LOCAL_WORKSPACE";
const originalEnv = process.env[ENV_KEY];
const isolatedTestWorkspace = process.env.OPENCLAW_TEST_WORKSPACE_ROOT;

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

  it("falls back to the isolated test workspace when the primary env is unset", () => {
    expect(isolatedTestWorkspace).toBeTruthy();
    expect(resolveDefaultWorkspaceRoot()).toBe(isolatedTestWorkspace);
  });

  it("ignores empty OPENCLAW_LOCAL_WORKSPACE", () => {
    process.env[ENV_KEY] = "   ";
    expect(resolveDefaultWorkspaceRoot()).toBe(isolatedTestWorkspace);
  });

  it("payload workspaceRoot still takes priority over env", async () => {
    const envWorkspace = makeWorkspace("unconfigured");
    const payloadWorkspace = makeWorkspace("tested");
    process.env[ENV_KEY] = envWorkspace;

    const config = await resolveRuntimeConfig({ artist: { workspaceRoot: payloadWorkspace } as never });
    expect(config.distribution.platforms.x.authStatus).toBe("tested");
  });

  // Regression coverage for the telegramCallbackHandler kick that called
  // resolveRuntimeConfig(undefined) with no payload at all: the schema default
  // ".local/openclaw/workspace" is a bare relative path (no leading "./"), which
  // isRelativeWorkspaceRoot's original check did not recognize as relative, so
  // the normalization below was skipped and the isolated fallback root never
  // took effect.
  it("normalizes the bare-relative schema default (no leading ./) to the resolved fallback root", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "runtime-config-bare-relative-"));
    // No runtime/config-overrides.json at all: applyConfigDefaults fills
    // artist.workspaceRoot with the literal schema default, unrelated to
    // `workspace` (the directory it was just read from).
    expect(defaultArtistRuntimeConfig.artist.workspaceRoot.startsWith("./")).toBe(false);

    const config = await resolveRuntimeConfig(undefined, workspace);

    expect(config.artist.workspaceRoot).toBe(workspace);
  });

  // Guard: when the persisted workspaceRoot already equals the root it was read
  // from — exactly the shape of an unconfigured deployment, where the schema
  // default IS both the fallback and the persisted value — normalizing it must
  // be a no-op. This is what keeps a real deployment's CWD-relative resolution
  // (no isolated root in play) byte-identical to before this fix: substituting
  // the same value for itself changes nothing observable.
  it("is a no-op when the persisted workspaceRoot already equals the resolution root (no isolated root in play)", async () => {
    const root = mkdtempSync(join(tmpdir(), "runtime-config-identity-"));
    mkdirSync(join(root, "runtime"), { recursive: true });
    writeFileSync(
      join(root, "runtime", "config-overrides.json"),
      JSON.stringify({ schemaVersion: 1, artist: { workspaceRoot: root } })
    );

    const config = await resolveRuntimeConfig(undefined, root);

    expect(config.artist.workspaceRoot).toBe(root);
  });
});
