import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildConfigResponse } from "../src/routes";
import { buildConfigDraft, buildConfigUpdatePatch } from "../ui/src/configEditor";

describe("config field source metadata", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("marks env-forced config fields as read-only in /config", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-config-meta-"));
    await mkdir(join(root, "runtime"), { recursive: true });
    await writeFile(join(root, "runtime", "config-overrides.json"), JSON.stringify({
      autopilot: { dryRun: true },
      music: { suno: { driver: "mock", submitMode: "skip" } },
      aiReview: { provider: "mock" }
    }), "utf8");
    vi.stubEnv("OPENCLAW_SUNO_LIVE", "on");
    vi.stubEnv("OPENCLAW_AUTOPILOT_DRYRUN_OVERRIDE", "off");
    vi.stubEnv("OPENCLAW_AI_REVIEW_PROVIDER", "openclaw");

    const config = await buildConfigResponse({ artist: { workspaceRoot: root } as never });

    expect(config.autopilot.dryRun).toBe(false);
    expect(config.music.suno.connectionMode).toBe("background_browser_worker");
    expect(config.music.suno.driver).toBe("playwright");
    expect(config.music.suno.submitMode).toBe("live");
    expect(config.aiReview.provider).toBe("openclaw");
    expect(config.fieldMeta["autopilot.dryRun"]).toMatchObject({ source: "env", editable: false, envVar: "OPENCLAW_AUTOPILOT_DRYRUN_OVERRIDE" });
    expect(config.fieldMeta["music.suno.connectionMode"]).toMatchObject({ source: "env", editable: false, envVar: "OPENCLAW_SUNO_LIVE" });
    expect(config.fieldMeta["music.suno.driver"]).toMatchObject({ source: "env", editable: false, envVar: "OPENCLAW_SUNO_LIVE" });
    expect(config.fieldMeta["music.suno.submitMode"]).toMatchObject({ source: "env", editable: false, envVar: "OPENCLAW_SUNO_LIVE" });
    expect(config.fieldMeta["aiReview.provider"]).toMatchObject({ source: "env", editable: false, envVar: "OPENCLAW_AI_REVIEW_PROVIDER" });
  });

  it("omits env-forced fields from config/update payloads", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-config-meta-payload-"));
    await mkdir(join(root, "runtime"), { recursive: true });
    vi.stubEnv("OPENCLAW_SUNO_DRIVER", "playwright");
    vi.stubEnv("OPENCLAW_AUTOPILOT_DRYRUN_OVERRIDE", "off");
    vi.stubEnv("OPENCLAW_AI_REVIEW_PROVIDER", "openai-codex");

    const config = await buildConfigResponse({ artist: { workspaceRoot: root } as never });
    const patch = buildConfigUpdatePatch(buildConfigDraft(config));

    expect(patch.autopilot).not.toHaveProperty("dryRun");
    expect(patch.music?.suno).not.toHaveProperty("driver");
    expect(patch.music?.suno).not.toHaveProperty("submitMode");
    expect(patch.aiReview).not.toHaveProperty("provider");
    expect(patch.autopilot?.cycleIntervalMinutes).toBe(180);
    expect(patch.music?.suno?.dailyCreditLimit).toBe(60);
  });
});
