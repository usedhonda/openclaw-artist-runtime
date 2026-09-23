import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  aiReviewProviders,
  dailySharingModes,
  instagramAuthorityModes,
  officialReleaseModes,
  platformAuthStatuses,
  producerDigestModes,
  sunoAuthorityModes,
  sunoConnectionModes,
  sunoDriverModes,
  sunoSubmitModes,
  tiktokAuthorityModes,
  uiLocaleModes,
  xAuthorityModes
} from "../src/types";

type JsonSchema = {
  properties?: Record<string, JsonSchema>;
  $defs?: Record<string, JsonSchema>;
  enum?: string[];
  $ref?: string;
};

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function resolveRef(node: JsonSchema, root: JsonSchema): JsonSchema {
  if (node.$ref) {
    const refKey = node.$ref.replace("#/$defs/", "");
    return resolveRef(root.$defs?.[refKey] ?? {}, root);
  }
  return node;
}

function getEnumAtPath(root: JsonSchema, path: string[]): string[] | undefined {
  let node: JsonSchema = root;
  for (const key of path) {
    node = resolveRef(node, root);
    const next = node.properties?.[key];
    if (!next) {
      return undefined;
    }
    node = next;
  }
  return resolveRef(node, root).enum;
}

// Each enum-typed config field maps to a canonical `as const` array in src/types.ts.
// The hand-written validateConfig (src/config/schema.ts) enforces these consts, while
// schemas/config.schema.json and the manifest configSchema ship the values to consumers.
// Drift between the three sources is otherwise unguarded.
const enumFields: Array<{ path: string[]; canonical: readonly string[] }> = [
  { path: ["autopilot", "producerDigest"], canonical: producerDigestModes },
  { path: ["music", "suno", "connectionMode"], canonical: sunoConnectionModes },
  { path: ["music", "suno", "driver"], canonical: sunoDriverModes },
  { path: ["music", "suno", "submitMode"], canonical: sunoSubmitModes },
  { path: ["music", "suno", "authority"], canonical: sunoAuthorityModes },
  { path: ["distribution", "dailySharing"], canonical: dailySharingModes },
  { path: ["distribution", "officialRelease"], canonical: officialReleaseModes },
  { path: ["distribution", "platforms", "x", "authStatus"], canonical: platformAuthStatuses },
  { path: ["distribution", "platforms", "x", "authority"], canonical: xAuthorityModes },
  { path: ["distribution", "platforms", "instagram", "authStatus"], canonical: platformAuthStatuses },
  { path: ["distribution", "platforms", "instagram", "authority"], canonical: instagramAuthorityModes },
  { path: ["distribution", "platforms", "tiktok", "authStatus"], canonical: platformAuthStatuses },
  { path: ["distribution", "platforms", "tiktok", "authority"], canonical: tiktokAuthorityModes },
  { path: ["aiReview", "provider"], canonical: aiReviewProviders },
  { path: ["ui", "locale"], canonical: uiLocaleModes }
];

function asSet(values: readonly string[]): string[] {
  return [...values].sort();
}

describe("config enum contract", () => {
  const schema = readJson("./schemas/config.schema.json") as JsonSchema;
  const manifest = readJson("./openclaw.plugin.json") as { configSchema: JsonSchema };
  const manifestSchema = manifest.configSchema;

  for (const field of enumFields) {
    const label = field.path.join(".");
    it(`${label} enum is consistent across types, schema.json, and manifest`, () => {
      const canonical = asSet(field.canonical);
      const schemaEnum = getEnumAtPath(schema, field.path);
      const manifestEnum = getEnumAtPath(manifestSchema, field.path);
      expect(schemaEnum, `schema.json missing enum at ${label}`).toBeDefined();
      expect(manifestEnum, `manifest missing enum at ${label}`).toBeDefined();
      expect(asSet(schemaEnum ?? []), `schema.json enum drift at ${label}`).toEqual(canonical);
      expect(asSet(manifestEnum ?? []), `manifest enum drift at ${label}`).toEqual(canonical);
    });
  }
});
