import { describe, expect, it } from "vitest";
import { defaultConfigLeafPaths, settingContract } from "../src/config/settingsContract";

describe("settings contract", () => {
  it("classifies every default config leaf", () => {
    const configured = new Set(defaultConfigLeafPaths());
    const contracted = new Set(settingContract.map((entry) => entry.path));

    const missing = [...configured].filter((path) => !contracted.has(path)).sort();
    expect(missing).toEqual([]);
  });

  it("keeps user-facing config out of undocumented no-op space", () => {
    const runtimeOrInvariant = new Set(["runtimeEffective", "enforcedInvariant", "deprecatedMigrated"]);
    const invalid = settingContract.filter((entry) => !runtimeOrInvariant.has(entry.kind));

    expect(invalid).toEqual([]);
  });
});
