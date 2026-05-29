import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAlertsResponse, buildArtistMindResponse, buildAuditLogResponse, buildConfigResponse, buildPlatformDetailResponse, buildPromptLedgerResponse, buildRecoveryResponse, buildSongDetailResponse, buildSongLedgerResponse, buildSongsResponse, buildStatusResponse, buildSunoStatusResponse } from "../src/routes";
import { acknowledgeAlert } from "../src/services/alertAcks";
import { createSongSkeleton } from "../src/repositories/songRepository";
import { readSongState, updateSongState, writeSongBrief } from "../src/services/artistState";
import { ArtistAutopilotService, pauseAutopilot, resumeAutopilot } from "../src/services/autopilotService";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { draftLyrics } from "../src/services/lyricsDrafting";
import { createAndPersistSunoPromptPack } from "../src/services/sunoPromptPackFiles";
import { prepareSocialAssets } from "../src/services/socialAssets";
import { publishSocialAction } from "../src/services/socialPublishing";
import { generateSunoRun, importSunoResults } from "../src/services/sunoRuns";
import { createSongIdea } from "../src/services/songIdeation";
import { SunoBrowserWorker } from "../src/services/sunoBrowserWorker";
import { readTakeHistory, selectTake } from "../src/services/takeSelection";
import { patchResolvedConfig } from "../src/services/runtimeConfig";

describe("artist state", () => {
  it("surfaces setup readiness for a fresh workspace", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-setup-"));
    await ensureArtistWorkspace(root);

    const status = await buildStatusResponse({ artist: { workspaceRoot: root } });
    const createArtist = status.setupReadiness.checklist.find((item) => item.id === "create_artist");
    const choosePlatforms = status.setupReadiness.checklist.find((item) => item.id === "choose_platforms");
    const connectSuno = status.setupReadiness.checklist.find((item) => item.id === "connect_suno");

    expect(status.setupReadiness.readyForAutopilot).toBe(false);
    expect(status.setupReadiness.nextRecommendedAction).toBe("Choose platforms");
    expect(createArtist?.state).toBe("complete");
    expect(choosePlatforms?.state).toBe("pending");
    expect(connectSuno?.state).toBe("pending");
  });

  it("updates song status without clobbering notes and syncs songbook", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-state-"));
    await ensureArtistWorkspace(root);
    await createSongSkeleton(root, "song-001");
    writeFileSync(
      join(root, "songs", "song-001", "song.md"),
      "# Ghost Station\n\n## Notes\n\nKeep the station image.\n",
      "utf8"
    );

    await writeSongBrief(root, "song-001", "# Brief\n\nNight transit residue.");
    await updateSongState(root, "song-001", {
      status: "lyrics",
      title: "Ghost Station",
      reason: "lyrics drafted"
    });

    const state = await readSongState(root, "song-001");
    const songFile = readFileSync(join(root, "songs", "song-001", "song.md"), "utf8");
    const songbook = readFileSync(join(root, "artist", "SONGBOOK.md"), "utf8");

    expect(state.status).toBe("lyrics");
    expect(state.briefPath).toContain("brief.md");
    expect(songFile).toContain("Keep the station image.");
    expect(songbook).toContain("| song-001 | Ghost Station | lyrics |");
  });
});

describe("suno and social pipelines", () => {
  it("creates song ideas with a brief and prompt ledger trail", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-idea-"));
    await ensureArtistWorkspace(root);

    const idea = await createSongIdea({
      workspaceRoot: root,
      artistReason: "found in the station static"
    });

    const brief = await readFile(idea.briefPath, "utf8");
    const ledger = await readFile(join(root, "songs", idea.songId, "prompts", "prompt-ledger.jsonl"), "utf8");

    expect(idea.status).toBe("brief");
    expect(brief).toContain("Why this song exists");
    expect(ledger).toContain("\"stage\":\"song_ideation\"");
    expect(ledger).toContain("\"stage\":\"song_brief_creation\"");
  });

  it("records dry-run Suno generate and import into persisted ledgers", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-run-"));
    await ensureArtistWorkspace(root);
    await createAndPersistSunoPromptPack({
      workspaceRoot: root,
      songId: "song-001",
      songTitle: "Ghost Station",
      artistReason: "night transit residue",
      lyricsText: "駅の光だけが\nまだ私を覚えている",
      knowledgePackVersion: "test-pack"
    });

    const generated = await generateSunoRun({ workspaceRoot: root, songId: "song-001" });
    const imported = await importSunoResults({
      workspaceRoot: root,
      songId: "song-001",
      runId: generated.runId,
      urls: ["https://example.com/take-1"],
      selectedTakeId: "take-1"
    });

    const runLog = await readFile(join(root, "songs", "song-001", "suno", "runs.jsonl"), "utf8");
    const promptLedger = await readFile(join(root, "songs", "song-001", "prompts", "prompt-ledger.jsonl"), "utf8");
    const state = await readSongState(root, "song-001");

    expect(generated.status).toBe("blocked_dry_run");
    expect(imported.status).toBe("imported");
    expect(runLog).toContain(`"runId":"${generated.runId}"`);
    expect(promptLedger).toContain("\"stage\":\"suno_prepare_to_create\"");
    expect(promptLedger).toContain("\"stage\":\"suno_result_import\"");
    expect(state.status).toBe("takes_imported");
    expect(state.selectedTakeId).toBe("take-1");
  });

  it("selects a take and prepares social assets from imported results", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-assets-"));
    await ensureArtistWorkspace(root);
    await createSongIdea({ workspaceRoot: root, artistReason: "quiet frequency" });
    await draftLyrics({ workspaceRoot: root, songId: "song-001" });
    await createAndPersistSunoPromptPack({
      workspaceRoot: root,
      songId: "song-001",
      songTitle: "Ghost Station",
      artistReason: "night transit residue",
      lyricsText: "station after midnight\nsignal under frost",
      knowledgePackVersion: "test-pack"
    });

    await importSunoResults({
      workspaceRoot: root,
      songId: "song-001",
      runId: "run-1",
      urls: ["https://example.com/take-1", "https://example.com/take-2"]
    });
    const selection = await selectTake({
      workspaceRoot: root,
      songId: "song-001",
      selectedTakeId: "take-2",
      reason: "take-2 holds the colder vocal"
    });
    const assets = await prepareSocialAssets({
      workspaceRoot: root,
      songId: "song-001",
      config: {
        distribution: {
          platforms: {
            x: { enabled: true }
          }
        }
      }
    });

    const selected = await readFile(join(root, "songs", "song-001", "suno", "selected-take.json"), "utf8");
    const state = await readSongState(root, "song-001");
    const takeHistory = await readTakeHistory(root, "song-001");

    expect(selection.selectedTakeId).toBe("take-2");
    expect(selected).toContain("take-2");
    expect(takeHistory[0]?.selectedTakeId).toBe("take-2");
    expect(assets[0]?.platform).toBe("x");
    expect(state.status).toBe("social_assets");
  });

  it("records denied social publish and exposes persisted status summaries", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-social-"));
    await ensureArtistWorkspace(root);
    await createAndPersistSunoPromptPack({
      workspaceRoot: root,
      songId: "song-001",
      songTitle: "Ghost Station",
      artistReason: "night transit residue",
      lyricsText: "駅の光だけが\nまだ私を覚えている",
      knowledgePackVersion: "test-pack"
    });
    await generateSunoRun({ workspaceRoot: root, songId: "song-001" });

    const social = await publishSocialAction({
      workspaceRoot: root,
      songId: "song-001",
      platform: "x",
      postType: "observation",
      text: "駅の光だけが、まだ私を覚えている。"
    });
    const status = await buildStatusResponse({
      artist: { workspaceRoot: root },
      distribution: {
        enabled: true,
        platforms: {
          x: { enabled: true }
        }
      }
    });

    const socialLedger = await readFile(join(root, "songs", "song-001", "social", "social-publish.jsonl"), "utf8");
    const auditLog = await readFile(join(root, "songs", "song-001", "audit", "actions.jsonl"), "utf8");
    const artistMind = await buildArtistMindResponse({ artist: { workspaceRoot: root } });
    const audit = await buildAuditLogResponse({ artist: { workspaceRoot: root } });
    const promptLedger = await buildPromptLedgerResponse("song-001", { artist: { workspaceRoot: root } });
    const recovery = await buildRecoveryResponse({ artist: { workspaceRoot: root } });

    expect(social.result.accepted).toBe(false);
    expect(social.entry.policyDecision?.policyDecision).toBe("deny_dry_run");
    expect(socialLedger).toContain("\"platform\":\"x\"");
    expect(auditLog).toContain("\"eventType\":\"social_publish\"");
    expect(status.recentSong?.songId).toBe("song-001");
    expect(status.lastSunoRun?.songId).toBe("song-001");
    expect(status.lastSocialAction?.platform).toBe("x");
    expect(Array.isArray(status.alerts)).toBe(true);
    expect(status.musicSummary.monthlyGenerationBudget).toBe(50);
    expect(status.distributionSummary.postsToday).toBeGreaterThanOrEqual(0);
    expect(status.distributionWorker.blockedReason).toContain("dry-run");
    expect(status.setupReadiness.checklist.find((item) => item.id === "run_dry_run_cycle")?.state).toBe("complete");
    expect(artistMind.artist).toContain("ARTIST");
    expect(audit[0]).toMatchObject({ eventType: "social_publish", songId: "song-001" });
    expect(promptLedger.some((entry) => entry.stage === "suno_prepare_to_create")).toBe(true);
    expect(recovery.recentAudit[0]).toMatchObject({ eventType: "social_publish", songId: "song-001" });
  });

  it("runs autopilot one stage at a time and exposes route helpers", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-autopilot-"));
    await ensureArtistWorkspace(root);
    const service = new ArtistAutopilotService();
    const config = {
      artist: { workspaceRoot: root },
      autopilot: { enabled: true },
      distribution: {
        platforms: {
          instagram: { enabled: true }
        }
      }
    };

    const first = await service.runCycle({ workspaceRoot: root, config });
    const second = await service.runCycle({ workspaceRoot: root, config });
    const third = await service.runCycle({ workspaceRoot: root, config });

    const songId = first.currentSongId ?? "song-001";
    await importSunoResults({
      workspaceRoot: root,
      songId,
      runId: "auto-import",
      urls: ["https://example.com/auto-take-1"]
    });
    const fourth = await service.runCycle({ workspaceRoot: root, config });
    const fifth = await service.runCycle({ workspaceRoot: root, config });
    const sixth = await service.runCycle({ workspaceRoot: root, config });

    const songs = await buildSongsResponse({ artist: { workspaceRoot: root } });
    const detail = await buildSongDetailResponse(songId, { artist: { workspaceRoot: root } });
    const ledger = await buildSongLedgerResponse(songId, { artist: { workspaceRoot: root } });
    const alerts = await buildAlertsResponse(config);
    const platform = await buildPlatformDetailResponse("instagram", config);
    const cfg = await buildConfigResponse({ artist: { workspaceRoot: root } });
    const sunoStatus = await buildSunoStatusResponse({ artist: { workspaceRoot: root } });
    const paused = await pauseAutopilot(root, "maintenance");
    const resumed = await resumeAutopilot(root);
    const status = await buildStatusResponse({
      artist: { workspaceRoot: root },
      autopilot: { enabled: true }
    });

    expect(first.stage).toBe("planning");
    expect(second.lastSuccessfulStage).toBe("prompt_pack");
    expect(third.lastSuccessfulStage).toBe("suno_generation");
    expect(fourth.lastSuccessfulStage).toBe("completed");
    expect(fifth.stage).toBe("planning");
    expect(sixth.lastSuccessfulStage).toBe("prompt_pack");
    expect(songs).toHaveLength(2);
    expect(detail.song.songId).toBe(songId);
    expect(detail.latestPromptPack?.version).toBe(1);
    expect(detail.takeHistory?.length).toBeGreaterThan(0);
    expect(ledger.length).toBeGreaterThan(0);
    expect(alerts.some((alert) => alert.message.includes("instagram"))).toBe(true);
    expect(platform.authority).toBe("auto_publish_visuals");
    expect(cfg.artist.workspaceRoot).toBe(root);
    expect(Array.isArray(sunoStatus.recentRuns)).toBe(true);
    expect(paused.paused).toBe(true);
    expect(resumed.paused).toBe(false);
    expect(status.autopilot.currentSongId).toBe(sixth.currentSongId);
    expect(status.setupReadiness.checklist.find((item) => item.id === "run_dry_run_cycle")?.state).toBe("complete");
  }, 30_000);

  it("persists dry-run-safe Suno connect and reconnect intents", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-worker-"));
    await ensureArtistWorkspace(root);
    const worker = new SunoBrowserWorker(root);

    const connectStatus = await worker.connect();
    const reconnectStatus = await worker.reconnect();
    const status = await buildSunoStatusResponse({ artist: { workspaceRoot: root } });

    expect(connectStatus.pendingAction).toBe("operator_login_required");
    expect(reconnectStatus.pendingAction).toBe("reconnect_requested");
    expect(status.worker.pendingAction).toBe("reconnect_requested");
    expect(status.worker.state).toBe("disconnected");
  });

  it("acknowledges structured alerts", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-alert-ack-"));
    await ensureArtistWorkspace(root);
    await pauseAutopilot(root, "maintenance");

    const before = await buildAlertsResponse({ artist: { workspaceRoot: root } });
    const autopilotAlert = before.find((alert) => alert.source === "autopilot");
    expect(autopilotAlert).toBeTruthy();

    await acknowledgeAlert(root, autopilotAlert!.id);

    const after = await buildAlertsResponse({ artist: { workspaceRoot: root } });
    expect(after.find((alert) => alert.id === autopilotAlert!.id)?.ackedAt).toBeTruthy();
  });

  it("persists config overrides for route-backed reads", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-config-"));
    await ensureArtistWorkspace(root);

    await patchResolvedConfig(root, {
      artist: { workspaceRoot: root, artistId: "ghost-artist" },
      autopilot: { enabled: true, dryRun: false }
    });

    const config = await buildConfigResponse({ artist: { workspaceRoot: root } });

    expect(config.artist.artistId).toBe("ghost-artist");
    expect(config.autopilot.enabled).toBe(true);
    expect(config.autopilot.dryRun).toBe(false);
  });
});
