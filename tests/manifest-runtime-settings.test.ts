import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { producerConsoleHtml } from "../src/routes/uiFallback";
import { aiReviewProviders } from "../src/types";

function readManifest(): {
  configSchema: {
    properties: {
      aiReview: { properties: { provider: { enum: string[] } } };
      music: { properties: { suno: { properties: { submitMode: { description: string } } } } };
    };
  };
  uiHints: Record<string, { label: string; help: string }>;
} {
  return JSON.parse(readFileSync("openclaw.plugin.json", "utf8"));
}

describe("runtime settings manifest contract", () => {
  it("keeps AI provider and Suno live-submit copy aligned with runtime support", () => {
    const manifest = readManifest();
    expect(manifest.configSchema.properties.aiReview.properties.provider.enum).toEqual([...aiReviewProviders]);
    expect(manifest.configSchema.properties.music.properties.suno.properties.submitMode.description).toContain("clicks Create");
    expect(manifest.configSchema.properties.music.properties.suno.properties.submitMode.description).not.toContain("rejected");
    expect(manifest.uiHints["music.suno.submitMode"].help).not.toContain("currently blocked");
  });

  it("documents operator-facing runtime settings in manifest uiHints", () => {
    const manifest = readManifest();
    const expectedHints = [
      "dashboard.baseUrl",
      "music.suno.maxGenerationsPerDay",
      "music.suno.minMinutesBetweenCreates",
      "artistPulse.enabled",
      "artistPulse.minIntervalHours",
      "commission.enabled",
      "songSpawn.enabled",
      "songSpawn.minIntervalHours"
    ];

    for (const path of expectedHints) {
      expect(manifest.uiHints[path]?.help).toBeTruthy();
    }
    expect(Object.keys(manifest.uiHints).some((path) => path.includes("dailyBudget"))).toBe(false);
    expect(JSON.stringify(manifest.configSchema)).not.toContain("dailyBudget");
  });

  it("keeps fallback settings on the current Suno credit and idea controls", async () => {
    const html = await producerConsoleHtml("/tmp/artist-runtime-no-built-ui");

    expect(html).toContain("cfg-daily-credit-limit");
    expect(html).toContain("cfg-monthly-credit-limit");
    expect(html).toContain("cfg-monthly-generation-budget");
    expect(html).toContain("cfg-max-generations-per-day");
    expect(html).toContain("cfg-min-minutes-between-creates");
    expect(html).toContain("cfg-dashboard-base-url");
    expect(html).toContain("cfg-song-spawn-enabled");
    expect(html).toContain("cfg-artist-pulse-enabled");
    expect(html).toContain("cfg-commission-enabled");
    expect(html).not.toContain("dailyBudget");
    expect(html).not.toContain("SettingsRuntimeOverridesPanel");
  });
});
