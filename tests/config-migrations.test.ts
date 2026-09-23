import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultArtistRuntimeConfig } from "../src/config/defaultConfig";
import { CURRENT_CONFIG_SCHEMA_VERSION, mockV1ToV2AddSchemaVersion, mockV2ToV3RenamePattern } from "../src/config/migrations";
import { validateConfig } from "../src/config/schema";
import { readResolvedConfig } from "../src/services/runtimeConfig";

describe("config migrations", () => {
  it("defaults to the current schema version", () => {
    expect(defaultArtistRuntimeConfig.schemaVersion).toBe(CURRENT_CONFIG_SCHEMA_VERSION);
    expect(validateConfig(defaultArtistRuntimeConfig)).toMatchObject({
      ok: true,
      value: {
        schemaVersion: CURRENT_CONFIG_SCHEMA_VERSION
      }
    });
  });

  it("adds schemaVersion to legacy config overrides during load", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-config-migrate-"));
    await mkdir(join(root, "runtime"), { recursive: true });
    await writeFile(
      join(root, "runtime", "config-overrides.json"),
      `${JSON.stringify({ autopilot: { enabled: true } }, null, 2)}\n`,
      "utf8"
    );

    const resolved = await readResolvedConfig(root);

    expect(resolved.schemaVersion).toBe(CURRENT_CONFIG_SCHEMA_VERSION);
    expect(resolved.autopilot.enabled).toBe(true);
  });

  it("rejects schema versions newer than the current runtime", () => {
    const result = validateConfig({ schemaVersion: CURRENT_CONFIG_SCHEMA_VERSION + 1 });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("config.schemaVersion must be an integer between 1 and 1");
  });

  it("keeps future migration skeleton helpers isolated from runtime activation", () => {
    expect(mockV1ToV2AddSchemaVersion({}).schemaVersion).toBe(2);
    expect(mockV2ToV3RenamePattern({ legacyArtistId: "ghost" })).toMatchObject({
      schemaVersion: 3,
      artist: {
        artistId: "ghost"
      }
    });
  });

  it("reset-config backs up current overrides and restores config.default.json", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-config-reset-"));
    await mkdir(join(root, "runtime"), { recursive: true });
    await writeFile(join(root, "runtime", "config-overrides.json"), "{\"autopilot\":{\"enabled\":true}}\n", "utf8");

    const output = execFileSync("bash", ["scripts/reset-config.sh", "--root", root], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    const reset = JSON.parse(await readFile(join(root, "runtime", "config-overrides.json"), "utf8"));

    expect(output).toContain("backup=");
    expect(output).toContain("reset=");
    expect(reset).toMatchObject({
      schemaVersion: CURRENT_CONFIG_SCHEMA_VERSION,
      autopilot: {
        enabled: true,
        dryRun: true
      }
    });
  });
});
