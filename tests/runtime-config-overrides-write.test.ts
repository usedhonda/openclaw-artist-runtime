import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readConfigOverrides, readResolvedConfig, writeRuntimeSafetyOverrides } from "../src/services/runtimeConfig";

describe("runtime safety config override writer", () => {
  it("deep-merges whitelisted runtime safety overrides and creates a backup", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-runtime-overrides-"));
    const runtimeDir = join(root, "runtime");
    await writeRuntimeSafetyOverrides(root, {
      bird: { rateLimits: { dailyMax: 2 } }
    });

    await writeRuntimeSafetyOverrides(root, {
      bird: { rateLimits: { dailyMax: 3, minIntervalMinutes: 90 } }
    });

    const overrides = await readConfigOverrides(root) as {
      bird?: { rateLimits?: { dailyMax?: number; minIntervalMinutes?: number } };
    };
    expect(overrides.bird?.rateLimits?.dailyMax).toBe(3);
    expect(overrides.bird?.rateLimits?.minIntervalMinutes).toBe(90);

    const backups = readdirSync(runtimeDir).filter((name) => /^config-overrides\.\d{8}T\d{6}Z\.bak\.json$/.test(name));
    expect(backups.length).toBeGreaterThanOrEqual(1);
    const backupText = readFileSync(join(runtimeDir, backups[0]!), "utf8");
    expect(backupText).toContain("\"dailyMax\": 2");

    const resolved = await readResolvedConfig(root);
    expect(resolved.autopilot.cycleIntervalMinutes).toBe(180);
  });

  it("creates config-overrides.json when no override file exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-runtime-overrides-new-"));

    await writeRuntimeSafetyOverrides(root, { bird: { rateLimits: { dailyMax: 8 } } });

    const overrides = await readConfigOverrides(root) as { bird?: { rateLimits?: { dailyMax?: number } } };
    expect(overrides.bird?.rateLimits?.dailyMax).toBe(8);
    expect(readdirSync(join(root, "runtime")).some((name) => name.endsWith(".bak.json"))).toBe(false);
  });
});
