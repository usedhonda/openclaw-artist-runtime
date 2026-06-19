import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it } from "vitest";
import { buildStatusResponse, registerRoutes } from "../src/routes";
import { resetAutopilotTickerForTest, AutopilotTicker } from "../src/services/autopilotTicker";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { patchResolvedConfig } from "../src/services/runtimeConfig";
import { createSongIdea } from "../src/services/songIdeation";
import { SunoBrowserWorker } from "../src/services/sunoBrowserWorker";

function createMockRequest(method: string, url: string, body?: string, headers?: Record<string, string>): IncomingMessage {
  const req = Readable.from(body ? [body] : []) as IncomingMessage;
  req.method = method;
  req.url = url;
  req.headers = headers ?? {};
  return req;
}

function createMockResponse() {
  let body = "";
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    headersSent: false,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return this;
    },
    end(chunk?: string | Buffer) {
      if (chunk) {
        body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      }
      this.headersSent = true;
      return this;
    }
  } as unknown as ServerResponse;

  return {
    res,
    readBody: () => body,
    readHeader: (name: string) => headers[name.toLowerCase()],
    readStatus: () => (res as unknown as { statusCode: number }).statusCode
  };
}

describe("status ticker and reply simulation routes", () => {
  beforeEach(() => {
    resetAutopilotTickerForTest();
  });

  it("surfaces autopilot ticker info in /api/status", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-status-ticker-"));
    await ensureArtistWorkspace(root);
    const ticker = new AutopilotTicker();

    await ticker.tick({
      artist: { workspaceRoot: root },
      autopilot: { enabled: true, dryRun: true, cycleIntervalMinutes: 2 }
    });

    const status = await buildStatusResponse({
      artist: { workspaceRoot: root },
      autopilot: { cycleIntervalMinutes: 2 }
    });

    expect(status.ticker.lastOutcome).toBe("ran");
    expect(status.ticker.lastTickAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(status.ticker.intervalMs).toBe(120000);
  });

  it("reads persisted config overrides into /api/status", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-status-config-"));
    await ensureArtistWorkspace(root);
    await patchResolvedConfig(root, {
      artist: { workspaceRoot: root },
      autopilot: { enabled: true, dryRun: false, songsPerWeek: 6, cycleIntervalMinutes: 15 },
      distribution: {
        enabled: true,
        liveGoArmed: false,
        platforms: {
          x: { enabled: true, liveGoArmed: true }
        }
      }
    });

    const status = await buildStatusResponse({
      artist: { workspaceRoot: root }
    });

    expect(status.autopilot.enabled).toBe(true);
    expect(status.config.autopilot.songsPerWeek).toBe(6);
    expect(status.config.autopilot.cycleIntervalMinutes).toBe(15);
    expect(status.config.autopilot.dryRun).toBe(false);
    expect(status.config.distribution.liveGoArmed).toBe(false);
    expect(status.config.distribution.platforms.x.enabled).toBe(true);
    expect(status.config.distribution.platforms.x.liveGoArmed).toBe(true);
    expect(status.ticker.intervalMs).toBe(900000);
    expect(status.distributionWorker.liveGoArmed).toBe(false);
    expect(status.distributionWorker.platformLiveGoArmed).toMatchObject({
      x: true,
      instagram: false,
      tiktok: false
    });
    expect(status.distributionWorker.effectiveDryRun).toMatchObject({
      x: true,
      instagram: true,
      tiktok: true
    });
    expect(status.summary.allPlatformsEffectivelyDryRun).toBe(true);
    expect(status.summary.effectiveDryRunMap).toMatchObject({
      x: true,
      instagram: true,
      tiktok: true
    });
    expect(status.distributionWorker.blockedReason).toContain("live-go arm");
    expect(status.platforms.x.liveGoArmed).toBe(true);
    expect(status.platforms.x.effectiveDryRun).toBe(true);
    expect(status.platforms.instagram.liveGoArmed).toBe(false);
    expect(status.platforms.instagram.effectiveDryRun).toBe(true);
    expect(status.platforms.tiktok.liveGoArmed).toBe(false);
    expect(status.platforms.tiktok.effectiveDryRun).toBe(true);
  });

  it("surfaces paused producer review instead of stale take-selection action", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-status-paused-review-"));
    await ensureArtistWorkspace(root);
    await mkdir(join(root, "runtime"), { recursive: true });
    await writeFile(join(root, "runtime", "autopilot-state.json"), `${JSON.stringify({
      stage: "take_selection",
      paused: true,
      pausedReason: "take selected after bounded one-shot Suno create; awaiting producer review",
      suspendedAt: "producer_review_after_take_selected",
      retryCount: 1,
      cycleCount: 17,
      updatedAt: "2026-05-15T08:04:27.306Z",
      runId: "auto_test",
      currentSongId: "spawn_test",
      lastSuccessfulStage: "take_selection"
    }, null, 2)}\n`, "utf8");

    const status = await buildStatusResponse({
      artist: { workspaceRoot: root },
      autopilot: { enabled: true, dryRun: false }
    });

    expect(status.autopilot.stage).toBe("paused");
    expect(status.autopilot.nextAction).toContain("/resume");
    expect(status.autopilot.currentSongId).toBe("spawn_test");
    expect(status.autopilot.pausedReason).toContain("awaiting producer review");
  });

  it("surfaces structured reauth-required next action in /api/status", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-status-reauth-"));
    await ensureArtistWorkspace(root);
    await mkdir(join(root, "runtime"), { recursive: true });
    await writeFile(join(root, "runtime", "autopilot-state.json"), `${JSON.stringify({
      stage: "paused",
      paused: true,
      pausedReason: "lyrics_generation_degraded: ai_provider_not_configured: 歌詞AIのトークン失効/未設定 — 再認証が必要",
      blockedReason: "lyrics_generation_degraded: ai_provider_not_configured: 歌詞AIのトークン失効/未設定 — 再認証が必要",
      retryCount: 1,
      cycleCount: 17,
      updatedAt: "2026-06-19T00:00:00.000Z",
      runId: "auto_reauth",
      currentSongId: "spawn_reauth"
    }, null, 2)}\n`, "utf8");

    const status = await buildStatusResponse({
      artist: { workspaceRoot: root },
      autopilot: { enabled: true, dryRun: false }
    });

    expect(status.autopilot.nextAction).toBe("次: 歌詞AIの再認証が必要。/resume では直りません");
    expect(status.autopilot.nextActionSummary).toMatchObject({
      kind: "reauth_required",
      currentLine: "今: 歌詞AIのトークンが失効し制作が止まっている",
      nextAction: "次: 歌詞AIの再認証が必要。/resume では直りません",
      songId: "spawn_reauth"
    });
  });

  it("surfaces armed global and X platform live-go state in /api/status", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-status-live-go-"));
    await ensureArtistWorkspace(root);
    await patchResolvedConfig(root, {
      artist: { workspaceRoot: root },
      autopilot: { enabled: true, dryRun: false },
      distribution: {
        enabled: true,
        liveGoArmed: true,
        platforms: {
          x: { enabled: true, liveGoArmed: true },
          instagram: { enabled: true, liveGoArmed: false },
          tiktok: { enabled: true, liveGoArmed: true }
        }
      }
    });

    const status = await buildStatusResponse({
      artist: { workspaceRoot: root }
    });

    expect(status.distributionWorker.liveGoArmed).toBe(true);
    expect(status.distributionWorker.platformLiveGoArmed).toMatchObject({
      x: true,
      instagram: false,
      tiktok: false
    });
    expect(status.distributionWorker.effectiveDryRun).toMatchObject({
      x: false,
      instagram: true,
      tiktok: true
    });
    expect(status.summary.allPlatformsEffectivelyDryRun).toBe(false);
    expect(status.summary.effectiveDryRunMap).toMatchObject({
      x: false,
      instagram: true,
      tiktok: true
    });
    expect(status.platforms.x.liveGoArmed).toBe(true);
    expect(status.platforms.x.effectiveDryRun).toBe(false);
    expect(status.platforms.tiktok.liveGoArmed).toBe(false);
    expect(status.platforms.tiktok.effectiveDryRun).toBe(true);
  });

  it("updates ticker getters when /api/run-cycle is triggered", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-run-cycle-ticker-"));
    await ensureArtistWorkspace(root);
    await patchResolvedConfig(root, {
      artist: { workspaceRoot: root },
      autopilot: { enabled: true, dryRun: true }
    });

    const registered = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void>();
    registerRoutes({
      registerHttpRoute(definition: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void }) {
        registered.set(definition.path, definition.handler);
      }
    });

    const handler = registered.get("/plugins/artist-runtime/api/run-cycle");
    expect(handler).toBeTruthy();

    const response = createMockResponse();
    await handler?.(
      createMockRequest(
        "POST",
        "/plugins/artist-runtime/api/run-cycle",
        JSON.stringify({
          config: { artist: { workspaceRoot: root } }
        }),
        { "content-type": "application/json" }
      ),
      response.res
    );

    expect(response.readStatus()).toBe(200);
    expect(JSON.parse(response.readBody())).toMatchObject({
      tickerOutcome: "ran"
    });

    const status = await buildStatusResponse({
      artist: { workspaceRoot: root }
    });
    expect(status.ticker.lastOutcome).toBe("ran");
    expect(status.ticker.lastTickAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("registers a dry-run simulate-reply route and keeps replies blocked", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-simulate-reply-"));
    await ensureArtistWorkspace(root);
    const created = await createSongIdea({ workspaceRoot: root, artistReason: "cold relay signal" });

    const registered = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void>();
    registerRoutes({
      registerHttpRoute(definition: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void }) {
        registered.set(definition.path, definition.handler);
      }
    });

    const handler = registered.get("/plugins/artist-runtime/api/platforms");
    expect(handler).toBeTruthy();

    const response = createMockResponse();
    await handler?.(
      createMockRequest(
        "POST",
        "/plugins/artist-runtime/api/platforms/x/simulate-reply",
        JSON.stringify({
          config: { artist: { workspaceRoot: root } },
          songId: created.songId,
          targetId: "1900000000000000000",
          text: "dry-run reply only"
        }),
        { "content-type": "application/json" }
      ),
      response.res
    );

    expect(response.readStatus()).toBe(200);
    expect(response.readHeader("content-type")).toContain("application/json");
    expect(JSON.parse(response.readBody())).toMatchObject({
      result: {
        accepted: false,
        dryRun: true,
        reason: "dry-run blocks social publish"
      },
      entry: {
        action: "reply",
        songId: created.songId,
        dryRun: true
      }
    });
  });

  it("surfaces imported paths and metadata through /api/status", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-status-import-meta-"));
    await ensureArtistWorkspace(root);
    const worker = new SunoBrowserWorker(root);

    await worker.start({
      driver: {
        async probe() {
          return { state: "connected" as const };
        },
        async importResults({ runId, urls }) {
          return {
            accepted: true,
            runId,
            urls,
            paths: [`${root}/runtime/suno/${runId}/song-1.mp3`],
            metadata: [
              {
                url: urls[0],
                path: `${root}/runtime/suno/${runId}/song-1.mp3`,
                title: "Recovered Track",
                durationSec: 187,
                format: "mp3" as const
              }
            ],
            importedAt: "2026-04-22T00:00:00.000Z",
            reason: "imported"
          };
        }
      }
    });
    await worker.importRun("run-status-meta", ["https://suno.com/song/song-1"], {
      driver: {
        async probe() {
          return { state: "connected" as const };
        },
        async importResults({ runId, urls }) {
          return {
            accepted: true,
            runId,
            urls,
            paths: [`${root}/runtime/suno/${runId}/song-1.mp3`],
            metadata: [
              {
                url: urls[0],
                path: `${root}/runtime/suno/${runId}/song-1.mp3`,
                title: "Recovered Track",
                durationSec: 187,
                format: "mp3" as const
              }
            ],
            importedAt: "2026-04-22T00:00:00.000Z",
            reason: "imported"
          };
        }
      }
    });

    const status = await buildStatusResponse({
      artist: { workspaceRoot: root }
    });

    expect(status.sunoWorker.lastImportOutcome).toMatchObject({
      runId: "run-status-meta",
      urlCount: 1,
      pathCount: 1,
      paths: [`${root}/runtime/suno/run-status-meta/song-1.mp3`],
      metadata: [
        {
          url: "https://suno.com/song/song-1",
          path: `${root}/runtime/suno/run-status-meta/song-1.mp3`,
          title: "Recovered Track",
          durationSec: 187,
          format: "mp3"
        }
      ]
    });
  });

  it("surfaces Suno budget state through /api/status", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-status-budget-"));
    await ensureArtistWorkspace(root);

    const status = await buildStatusResponse({
      artist: { workspaceRoot: root }
    });

    expect(status.suno.budget).toMatchObject({
      date: expect.stringMatching(/\d{4}-\d{2}-\d{2}/),
      consumed: 0,
      limit: 60,
      remaining: 60,
      monthly: {
        month: expect.stringMatching(/\d{4}-\d{2}/),
        consumed: 0,
        limit: 0,
        remaining: 0,
        unlimited: true
      }
    });
  });

  it("resets stale Suno budget state on read-only status views", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-status-budget-reset-"));
    await ensureArtistWorkspace(root);
    await mkdir(join(root, "runtime", "suno"), { recursive: true });
    await writeFile(
      join(root, "runtime", "suno", "budget.json"),
      `${JSON.stringify({ date: "2000-01-01", consumed: 60 }, null, 2)}\n`,
      "utf8"
    );

    const status = await buildStatusResponse({
      artist: { workspaceRoot: root }
    });

    expect(status.suno.budget.consumed).toBe(0);
    expect(status.suno.budget.remaining).toBe(60);
    expect(status.suno.budget.limit).toBe(60);
    expect(status.suno.budget.date).not.toBe("2000-01-01");
    expect(status.suno.budget.monthly.consumed).toBe(0);
  });

  it("surfaces Suno reset history and runtime artifact index through /api/status", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-status-suno-visibility-"));
    await ensureArtistWorkspace(root);
    await mkdir(join(root, "runtime", "suno", "run-visible"), { recursive: true });
    await writeFile(
      join(root, "runtime", "suno", "budget-reset.jsonl"),
      `${JSON.stringify({ timestamp: "2026-04-23T12:00:00.000Z", consumedBefore: 40, reason: "operator_reset" })}\n`,
      "utf8"
    );
    await writeFile(join(root, "runtime", "suno", "run-visible", "take.mp3"), "audio-bytes", "utf8");

    const status = await buildStatusResponse({
      artist: { workspaceRoot: root }
    });

    expect(status.suno.budget.resetHistory).toEqual([
      {
        timestamp: "2026-04-23T12:00:00.000Z",
        consumedBefore: 40,
        reason: "operator_reset"
      }
    ]);
    expect(status.suno.artifacts).toMatchObject([
      {
        runId: "run-visible",
        format: "mp3",
        path: join(root, "runtime", "suno", "run-visible", "take.mp3")
      }
    ]);
    expect(status.suno.artifacts[0]?.size).toBeGreaterThan(0);
  });

  it("surfaces persisted Suno profile stale state under /api/status.suno.profile", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-status-suno-profile-"));
    await ensureArtistWorkspace(root);
    await mkdir(join(root, "runtime"), { recursive: true });
    await writeFile(
      join(root, "runtime", "suno-worker.json"),
      `${JSON.stringify({
        state: "connected",
        connected: true,
        failureCount: 0,
        sunoProfileStale: true,
        sunoProfileDetail: "profile missing",
        sunoProfileCheckedAt: "2026-04-23T12:00:00.000Z"
      }, null, 2)}\n`,
      "utf8"
    );

    const status = await buildStatusResponse({
      artist: { workspaceRoot: root }
    });

    expect(status.suno.profile).toEqual({
      stale: true,
      detail: "profile missing",
      checkedAt: "2026-04-23T12:00:00.000Z"
    });
  });
});
