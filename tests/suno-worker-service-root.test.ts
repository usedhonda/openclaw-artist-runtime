import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registerServices } from "../src/services";
import { SunoBrowserWorker } from "../src/services/sunoBrowserWorker";

type RegisteredService = {
  id: string;
  start: () => Promise<unknown>;
};

const originalCwd = process.cwd();
const originalWorkspace = process.env.OPENCLAW_LOCAL_WORKSPACE;
const originalSunoLive = process.env.OPENCLAW_SUNO_LIVE;

afterEach(() => {
  process.chdir(originalCwd);
  if (originalWorkspace === undefined) {
    delete process.env.OPENCLAW_LOCAL_WORKSPACE;
  } else {
    process.env.OPENCLAW_LOCAL_WORKSPACE = originalWorkspace;
  }
  if (originalSunoLive === undefined) {
    delete process.env.OPENCLAW_SUNO_LIVE;
  } else {
    process.env.OPENCLAW_SUNO_LIVE = originalSunoLive;
  }
});

describe("Suno worker service workspace root", () => {
  it("reads worker state from OPENCLAW_LOCAL_WORKSPACE on boot without probing or touching cwd", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "artist-runtime-service-workspace-"));
    const cwdRoot = mkdtempSync(join(tmpdir(), "artist-runtime-service-cwd-"));
    const services = new Map<string, RegisteredService>();
    const api = {
      registerService(definition: RegisteredService) {
        services.set(definition.id, definition);
      }
    };

    process.env.OPENCLAW_LOCAL_WORKSPACE = workspaceRoot;
    process.env.OPENCLAW_SUNO_LIVE = "off";
    process.chdir(cwdRoot);

    // Seed a known-good connected state in the workspace root. Boot must read this
    // and must NOT auto-probe — a probe would launch a browser and could clobber it
    // (the false negative this fix removes).
    await new SunoBrowserWorker(workspaceRoot).setState("connected");

    registerServices(api);
    const status = (await services.get("sunoBrowserWorker")?.start()) as {
      state?: string;
      connected?: boolean;
    };

    // Boot resolved the workspace root, returned the persisted connected state intact
    // (no clobber), and never wrote worker state under the process cwd.
    expect(status?.state).toBe("connected");
    expect(status?.connected).toBe(true);
    expect(existsSync(join(workspaceRoot, "runtime", "suno-worker.json"))).toBe(true);
    expect(existsSync(join(cwdRoot, "runtime", "suno-worker.json"))).toBe(false);
  });
});
