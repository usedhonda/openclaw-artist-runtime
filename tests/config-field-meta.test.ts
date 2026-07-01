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

  it("surfaces dashboard env fallback as editable instead of read-only", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-config-meta-dashboard-"));
    await mkdir(join(root, "runtime"), { recursive: true });
    vi.stubEnv("OPENCLAW_DASHBOARD_BASE_URL", "https://tailnet.example.test");

    const config = await buildConfigResponse({ artist: { workspaceRoot: root } as never });
    const patch = buildConfigUpdatePatch(buildConfigDraft(config));

    expect(config.dashboard.baseUrl).toBe("https://tailnet.example.test");
    expect(config.fieldMeta["dashboard.baseUrl"]).toMatchObject({ source: "env", editable: true, envVar: "OPENCLAW_DASHBOARD_BASE_URL" });
    expect(patch.dashboard?.baseUrl).toBe("https://tailnet.example.test");
  });

  it("uses configured dashboard URL ahead of env fallback", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-config-meta-dashboard-config-"));
    await mkdir(join(root, "runtime"), { recursive: true });
    await writeFile(join(root, "runtime", "config-overrides.json"), JSON.stringify({
      dashboard: { baseUrl: "https://config.example.test" }
    }), "utf8");
    vi.stubEnv("OPENCLAW_DASHBOARD_BASE_URL", "https://env.example.test");

    const config = await buildConfigResponse({ artist: { workspaceRoot: root } as never });

    expect(config.dashboard.baseUrl).toBe("https://config.example.test");
    expect(config.fieldMeta["dashboard.baseUrl"]).toMatchObject({ source: "config", editable: true });
  });

  it("surfaces runtime diagnostics without leaking credential or source values", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-config-meta-diagnostics-"));
    await mkdir(join(root, "runtime"), { recursive: true });
    vi.stubEnv("OPENCLAW_NEWS_RSS_URLS", "https://secret-news.example/rss,https://another-secret.example/rss");
    vi.stubEnv("OPENCLAW_NEWS_BROWSER_RESOLVE", "on");
    vi.stubEnv("OPENCLAW_NEWS_ARTICLE_RESOLVE", "off");
    vi.stubEnv("OPENCLAW_X_FIREFOX_PROFILE", "/Users/operator/PrivateFirefoxProfile");
    vi.stubEnv("OPENCLAW_X_TCO_FETCH_ENABLED", "1");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123456:secret-token-value");
    vi.stubEnv("TELEGRAM_OWNER_USER_IDS", "111111,222222");
    vi.stubEnv("OPENCLAW_TELEGRAM_NOTIFIER", "on");

    const config = await buildConfigResponse({ artist: { workspaceRoot: root } as never });
    const serialized = JSON.stringify(config);

    expect(config.diagnostics.newsX.rssUrls).toMatchObject({ count: 2, configured: true, editable: false, source: "env", envVar: "OPENCLAW_NEWS_RSS_URLS" });
    expect(config.diagnostics.newsX.browserResolve).toMatchObject({ enabled: true, editable: false, source: "env" });
    expect(config.diagnostics.newsX.articleResolve).toMatchObject({ enabled: false, editable: false, source: "env" });
    expect(config.diagnostics.newsX.firefoxProfile).toMatchObject({ configured: true, editable: false, source: "env", envVar: "OPENCLAW_X_FIREFOX_PROFILE" });
    expect(config.diagnostics.newsX.tcoFetch).toMatchObject({ enabled: true, editable: false, source: "env" });
    expect(config.diagnostics.telegram.active).toBe(true);
    expect(config.diagnostics.telegram.reason).toBe("ready");
    expect(config.diagnostics.telegram.botToken).toMatchObject({ configured: true, editable: false, source: "env", envVar: "TELEGRAM_BOT_TOKEN" });
    expect(config.diagnostics.telegram.ownerUserIds).toMatchObject({ count: 2, configured: true, editable: false, source: "env", envVar: "TELEGRAM_OWNER_USER_IDS" });
    expect(serialized).not.toContain("secret-news.example");
    expect(serialized).not.toContain("another-secret.example");
    expect(serialized).not.toContain("PrivateFirefoxProfile");
    expect(serialized).not.toContain("secret-token-value");
    expect(serialized).not.toContain("111111");
    expect(serialized).not.toContain("222222");
  });
});
