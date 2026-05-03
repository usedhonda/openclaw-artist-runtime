import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registerServices } from "../src/services";

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
  it("uses OPENCLAW_LOCAL_WORKSPACE instead of process cwd for worker state", async () => {
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

    registerServices(api);
    await services.get("sunoBrowserWorker")?.start();

    expect(existsSync(join(workspaceRoot, "runtime", "suno-worker.json"))).toBe(true);
    expect(existsSync(join(cwdRoot, "runtime", "suno-worker.json"))).toBe(false);
  });
});
