import { mkdtempSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { draftLyrics } from "../src/services/lyricsDrafting";
import {
  LYRICS_KNOWLEDGE_DIGEST_FILES,
  LYRICS_WRITER_INSTRUCTIONS_ATTRIBUTION,
  buildLyricsDraftingPrompt,
  readLyricsKnowledgeDigest
} from "../src/services/lyricsDraftingPrompt";
import { readSongState } from "../src/services/artistState";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";

async function workspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-lyrics-ai-"));
  await mkdir(join(root, "artist"), { recursive: true });
  await mkdir(join(root, "songs", "song-001", "lyrics"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), "used::honda watches civic noise and soft decay.\n", "utf8");
  await writeFile(join(root, "artist", "CURRENT_STATE.md"), "## Current Obsessions\n- group chats replacing civic rooms\n", "utf8");
  await writeFile(join(root, "artist", "SOCIAL_VOICE.md"), "short and unsentimental\n", "utf8");
  await writeFile(join(root, "songs", "song-001", "song.md"), "# Dead Neon Clock\n", "utf8");
  await writeFile(join(root, "songs", "song-001", "brief.md"), [
    "# Brief",
    "## Observation source",
    "- Path: observations/2026-04-30.md",
    "- Extract:",
    "government WhatsApp groups make responsibility leave the room"
  ].join("\n"), "utf8");
  return root;
}

describe("AI lyrics drafting", () => {
  it("builds a strengthened lyrics prompt from the attributed lyrics-writer source and expanded knowledge references", async () => {
    const prompt = buildLyricsDraftingPrompt({
      artistMd: "artist mind",
      currentState: "current state",
      briefText: "brief",
      title: "Dead Neon Clock",
      knowledgeDigest: "knowledge"
    });

    expect(prompt).toContain(LYRICS_WRITER_INSTRUCTIONS_ATTRIBUTION);
    expect(prompt).toContain("韻");
    expect(prompt).toContain("伏線");
    expect(prompt).toContain("情景");
    expect(prompt).toContain("パターンA");
    expect(prompt).toContain("rap_and_flow.md");
    expect(prompt).toContain("english_lyrics.md");
    expect(prompt).toContain("master_reference.md");
    expect(prompt).toContain("Suno lyrics box limit: 1250 characters total");
    expect(LYRICS_KNOWLEDGE_DIGEST_FILES).toContain("rap_and_flow.md");
    expect(LYRICS_KNOWLEDGE_DIGEST_FILES).toContain("english_lyrics.md");
    expect(LYRICS_KNOWLEDGE_DIGEST_FILES).toContain("master_reference.md");

    const digest = await readLyricsKnowledgeDigest();
    expect(digest).toContain("## rap_and_flow.md");
    expect(digest).toContain("## english_lyrics.md");
    expect(digest).toContain("## master_reference.md");
  });

  it("drafts lyrics, short title, and mood hint from the observation-bearing brief", async () => {
    const root = await workspace();
    const result = await draftLyrics({ workspaceRoot: root, songId: "song-001", aiReviewProvider: "mock" });
    const state = await readSongState(root, "song-001");

    expect(result.lyricsText).toContain("government WhatsApp groups");
    expect(state.title.split(/\s+/).length).toBeLessThanOrEqual(4);
    expect(state.degradedLyrics).toBe(false);
    expect(readFileSync(join(root, "songs", "song-001", "mood-hint.txt"), "utf8")).toContain("observed urban unease");
  });

  it("marks degraded lyrics and stops with reauth-required reason when the provider is not configured", async () => {
    const root = await workspace();
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));

    try {
      await expect(draftLyrics({ workspaceRoot: root, songId: "song-001", aiReviewProvider: "openclaw" })).rejects.toThrow("lyrics_generation_degraded");
      const state = await readSongState(root, "song-001");
      const degraded = events.find((event) => event.type === "lyrics_generation_degraded");
      expect(state.degradedLyrics).toBe(true);
      expect(state.status).toBe("brief");
      expect(state.lastReason).toContain("lyrics_generation_degraded:");
      expect(degraded).toMatchObject({
        type: "lyrics_generation_degraded",
        songId: "song-001",
        reason: expect.stringContaining("lyrics_generation_degraded:"),
        detail: expect.stringContaining("ai_provider_not_configured"),
        repairNotes: ["ai_provider_not_configured: 歌詞AIのトークン失効/未設定 — 再認証が必要"]
      });
    } finally {
      unsubscribe();
    }
  });

  it("redrafts within the Suno box and fails closed instead of trimming lyrics after max attempts", async () => {
    const root = await workspace();
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));
    vi.stubEnv("OPENCLAW_SUNO_LYRICS_LIMIT", "300");

    try {
      await expect(draftLyrics({ workspaceRoot: root, songId: "song-001", aiReviewProvider: "mock" })).rejects.toThrow("lyrics_too_long_for_suno_box");
      const state = await readSongState(root, "song-001");
      const degraded = events.find((event) => event.type === "lyrics_generation_degraded");
      expect(state.degradedLyrics).toBe(true);
      expect(state.status).toBe("brief");
      expect(state.lastReason).toContain("lyrics_too_long_for_suno_box");
      expect(degraded).toMatchObject({
        type: "lyrics_generation_degraded",
        songId: "song-001",
        reason: expect.stringContaining("lyrics_too_long_for_suno_box"),
        detail: expect.stringContaining("lyrics_too_long_for_suno_box")
      });
    } finally {
      vi.unstubAllEnvs();
      unsubscribe();
    }
  });
});
