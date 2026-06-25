import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { formatRuntimeEvent } from "../src/services/telegramNotifier";
import type { RuntimeEvent } from "../src/services/runtimeEventBus";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-v10-28-resources-"));
}

async function writeSongFile(root: string, songId: string, relative: string, content: string): Promise<void> {
  const full = join(root, "songs", songId, relative);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content, "utf8");
}

async function prepareSongFiles(root: string, songId: string, files: Record<string, string>): Promise<void> {
  await ensureArtistWorkspace(root);
  for (const [relative, content] of Object.entries(files)) {
    await writeSongFile(root, songId, relative, content);
  }
}

function promptPackReadyEvent(songId = "song-x1"): Extract<RuntimeEvent, { type: "prompt_pack_ready" }> {
  return {
    type: "prompt_pack_ready",
    songId,
    title: "Test Pack",
    lyricsExcerpt: "first line",
    mood: "calm",
    tempo: "100 BPM",
    styleNotes: "soft synths",
    voiceTop: "あたしの dummy voice",
    timestamp: Date.parse("2026-05-12T00:00:00.000Z")
  };
}

function songTakeCompletedEvent(songId = "song-x1"): Extract<RuntimeEvent, { type: "song_take_completed" }> {
  return {
    type: "song_take_completed",
    songId,
    selectedTakeId: "take-1",
    urls: ["https://suno.example/take-1"],
    timestamp: Date.parse("2026-05-12T00:00:00.000Z")
  };
}

function songSpawnProposedEvent(candidateSongId = "spawn_a1"): Extract<RuntimeEvent, { type: "song_spawn_proposed" }> {
  return {
    type: "song_spawn_proposed",
    candidateSongId,
    voiceTop: "次の曲どう?",
    reason: "fixture reason",
    brief: {
      songId: candidateSongId,
      title: "Spawn Test",
      brief: "fixture brief",
      lyricsTheme: "fixture theme",
      mood: "calm",
      tempo: "100",
      duration: "3:00",
      styleNotes: "fixture",
      sourceText: "fixture",
      createdAt: "2026-05-12T00:00:00.000Z"
    },
    timestamp: Date.parse("2026-05-12T00:00:00.000Z")
  };
}

function artistPulseDraftedEvent(): Extract<RuntimeEvent, { type: "artist_pulse_drafted" }> {
  return {
    type: "artist_pulse_drafted",
    voiceKind: "daily_voice",
    draftText: "ふと感じた一行",
    draftHash: "a".repeat(40),
    charCount: 8,
    rationale: "no specific reason",
    timestamp: Date.parse("2026-05-12T00:00:00.000Z")
  };
}

function autopilotStageChangedEvent(): Extract<RuntimeEvent, { type: "autopilot_stage_changed" }> {
  return {
    type: "autopilot_stage_changed",
    songId: "song-x1",
    from: "idle",
    to: "planning",
    timestamp: Date.parse("2026-05-12T00:00:00.000Z")
  };
}

describe("v10.28-C Phase A: Resources section injection", () => {
  it("attaches local paths and dashboard link for prompt_pack_ready when files exist", async () => {
    const root = workspace();
    await prepareSongFiles(root, "song-x1", {
      "brief.md": "fixture brief",
      "lyrics/lyrics.v1.md": "old lyrics",
      "lyrics/lyrics.v2.md": "latest lyrics",
      "suno/style.md": "moody",
      "song.md": "state"
    });

    const body = await formatRuntimeEvent(promptPackReadyEvent(), {
      workspaceRoot: root,
      dashboardBaseUrl: "https://example.test"
    });

    expect(body).toContain("─────");
    expect(body).toContain("📂 Local:");
    expect(body).toContain("songs/song-x1/brief.md");
    expect(body).toContain("songs/song-x1/lyrics/lyrics.v2.md");
    expect(body).not.toContain("songs/song-x1/lyrics/lyrics.v1.md");
    expect(body).toContain("songs/song-x1/suno/style.md");
    expect(body).toContain("songs/song-x1/song.md");
    expect(body).toContain("🔗 Dashboard: https://example.test/plugins/artist-runtime#song=song-x1");
  });

  it("emits song.md + suno/runs.jsonl + latest lyrics for song_take_completed", async () => {
    const root = workspace();
    await prepareSongFiles(root, "song-x1", {
      "song.md": "state",
      "suno/runs.jsonl": "{}",
      "lyrics/lyrics.v3.md": "latest"
    });

    const body = await formatRuntimeEvent(songTakeCompletedEvent(), {
      workspaceRoot: root,
      dashboardBaseUrl: "https://example.test"
    });

    expect(body).toContain("songs/song-x1/song.md");
    expect(body).toContain("songs/song-x1/suno/runs.jsonl");
    expect(body).toContain("songs/song-x1/lyrics/lyrics.v3.md");
    expect(body).toContain("🔗 Dashboard: https://example.test/plugins/artist-runtime#song=song-x1");
  });

  it("keeps spawn proposal cards free of local-path and dashboard resource clutter", async () => {
    const root = workspace();
    await ensureArtistWorkspace(root);

    const body = await formatRuntimeEvent(songSpawnProposedEvent("spawn_a1"), {
      workspaceRoot: root,
      dashboardBaseUrl: "https://example.test"
    });

    expect(body).not.toContain("📂 Local:");
    expect(body).not.toContain("🔗 Dashboard:");
    expect(body).toContain("素案: Spawn Test");
  });

  it("emits dashboard root only for events without a songId (artist_pulse_drafted)", async () => {
    const root = workspace();
    await ensureArtistWorkspace(root);

    const body = await formatRuntimeEvent(artistPulseDraftedEvent(), {
      workspaceRoot: root,
      dashboardBaseUrl: "https://example.test"
    });

    expect(body).not.toContain("📂 Local:");
    expect(body).toContain("🔗 Dashboard: https://example.test/plugins/artist-runtime");
    expect(body).not.toMatch(/Dashboard:.*#song=/);
  });

  it("omits local resources from spawn proposal cards even when files exist", async () => {
    const root = workspace();
    await prepareSongFiles(root, "song-x1", { "brief.md": "fixture" });

    const body = await formatRuntimeEvent(songSpawnProposedEvent("song-x1"), {
      workspaceRoot: root
    });

    expect(body).not.toContain("📂 Local:");
    expect(body).not.toContain("songs/song-x1/brief.md");
    expect(body).not.toContain("🔗 Dashboard");
  });

  it("collapses to a no-op when both workspaceRoot and dashboardBaseUrl are missing", async () => {
    const event = promptPackReadyEvent();
    const enrichedBody = await formatRuntimeEvent(event);
    const baselineBody = await formatRuntimeEvent(event, { workspaceRoot: undefined, dashboardBaseUrl: undefined });

    expect(enrichedBody).not.toContain("📂 Local:");
    expect(enrichedBody).not.toContain("🔗 Dashboard");
    expect(enrichedBody).toEqual(baselineBody);
  });

  it("does not append Resources for non-voice events such as autopilot_stage_changed", async () => {
    const root = workspace();
    await prepareSongFiles(root, "song-x1", { "brief.md": "fixture" });

    const body = await formatRuntimeEvent(autopilotStageChangedEvent(), {
      workspaceRoot: root,
      dashboardBaseUrl: "https://example.test"
    });

    expect(body).not.toContain("📂 Local:");
    expect(body).not.toContain("🔗 Dashboard");
  });

  it("keeps spawn proposal cards free of dashboard links even with trailing slashes", async () => {
    const root = workspace();
    await ensureArtistWorkspace(root);

    const body = await formatRuntimeEvent(songSpawnProposedEvent("spawn_a2"), {
      workspaceRoot: root,
      dashboardBaseUrl: "https://example.test/////"
    });

    expect(body).not.toContain("https://example.test/plugins/artist-runtime#song=spawn_a2");
    expect(body).not.toContain("test/////");
  });
});
