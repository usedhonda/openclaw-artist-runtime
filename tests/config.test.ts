import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultArtistRuntimeConfig } from "../src/config/defaultConfig";
import { applyConfigDefaults, validateConfig } from "../src/config/schema";

type JsonSchema = {
  properties?: Record<string, JsonSchema>;
  $defs?: Record<string, JsonSchema>;
  default?: unknown;
  $ref?: string;
};

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function extractDefaults(schema: JsonSchema, root: JsonSchema): unknown {
  if (schema.$ref) {
    const refKey = schema.$ref.replace("#/$defs/", "");
    return extractDefaults(root.$defs?.[refKey] ?? {}, root);
  }
  if (schema.default !== undefined) {
    return schema.default;
  }
  if (schema.properties) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      const extracted = extractDefaults(value, root);
      if (extracted !== undefined) {
        result[key] = extracted;
      }
    }
    return result;
  }
  return undefined;
}

describe("config schema", () => {
  it("starts enabled but dry-run protected", () => {
    expect(defaultArtistRuntimeConfig.autopilot.enabled).toBe(true);
    expect(defaultArtistRuntimeConfig.autopilot.dryRun).toBe(true);
  });

  it("rejects unknown keys", () => {
    const result = validateConfig({ unknown: true });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("not allowed");
  });

  it("rejects non-boolean global live-go flags", () => {
    const result = validateConfig({
      distribution: {
        liveGoArmed: "yes"
      }
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("config.distribution.liveGoArmed must be a boolean");
  });

  it("applies defaults to partial config", () => {
    const merged = applyConfigDefaults({ autopilot: { enabled: true } });
    expect(merged.autopilot.enabled).toBe(true);
    expect(merged.autopilot.dryRun).toBe(true);
    expect(merged.music.suno.dailyCreditLimit).toBe(60);
    expect(merged.music.suno.monthlyCreditLimit).toBe(0);
    expect(merged.distribution.liveGoArmed).toBe(false);
    expect(merged.distribution.platforms.x.liveGoArmed).toBe(false);
    expect(merged.distribution.platforms.instagram.liveGoArmed).toBe(false);
    expect(merged.distribution.platforms.tiktok.liveGoArmed).toBe(false);
    expect(merged.music.suno.authority).toBe("auto_create_and_select_take");
    expect(merged.ui.locale).toBe("auto");
  });

  it("accepts supported Producer Room locales", () => {
    const result = validateConfig({
      ui: {
        locale: "ja"
      }
    });
    expect(result.ok).toBe(true);
    expect(result.value.ui.locale).toBe("ja");
  });

  it("rejects unsupported Producer Room locales", () => {
    const result = validateConfig({
      ui: {
        locale: "fr"
      }
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("config.ui.locale must be one of auto, ja, en");
  });

  it("rejects non-boolean platform live-go flags", () => {
    const result = validateConfig({
      distribution: {
        platforms: {
          instagram: {
            liveGoArmed: "yes"
          }
        }
      }
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("config.distribution.platforms.instagram.liveGoArmed must be a boolean");
  });

  it("keeps manifest schema and schema copy aligned", () => {
    const manifest = readJson("./openclaw.plugin.json") as { configSchema: unknown };
    const schemaCopy = readJson("./schemas/config.schema.json");
    expect(manifest.configSchema).toEqual(schemaCopy);
  });

  it("keeps default config aligned with schema defaults", () => {
    const schema = readJson("./schemas/config.schema.json") as JsonSchema;
    expect(extractDefaults(schema, schema)).toEqual(defaultArtistRuntimeConfig);
  });
});
