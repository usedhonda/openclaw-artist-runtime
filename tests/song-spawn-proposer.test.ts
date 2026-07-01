import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerCallbackAction } from "../src/services/callbackActionRegistry";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
import { AGGRESSIVE_ARTIST_MOOD } from "../src/services/creativeVariationPolicy";
import { proposeSpawn } from "../src/services/songSpawnProposer";

async function workspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-spawn-proposer-"));
  await mkdir(join(root, "observations"), { recursive: true });
  await mkdir(join(root, "runtime"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), "obsessions: 再開発の経済合理性、夜の街、皮肉\n", "utf8");
  await writeFile(join(root, "SOUL.md"), "mood: observational\n", "utf8");
  await writeFile(join(root, "observations", "2026-04-29.md"), "再開発で古いライブハウスが消え、跡地に同じ色の看板だけが増えた。\n", "utf8");
  await writeFile(join(root, "runtime", "heartbeat-state.json"), JSON.stringify({ mood: "observational" }), "utf8");
  return root;
}

describe("song spawn proposer", () => {
  it("proposes a next-song brief from observations and budget", async () => {
    const root = await workspace();
    const proposal = await proposeSpawn(root, { aiReviewProvider: "mock", now: new Date("2026-04-29T00:00:00.000Z") });

    expect(proposal?.spawn).toBe(true);
    expect(proposal?.candidateSongId).toMatch(/^spawn_/);
    expect(proposal?.brief.songId).toBe(proposal?.candidateSongId);
    expect(proposal?.brief.brief).toContain("ライブハウス");
    expect(proposal?.brief.mood).toBe(AGGRESSIVE_ARTIST_MOOD);
    expect(proposal?.reason).toMatch(/[ぁ-ん一-龠]/);
    expect(proposal?.reason).not.toMatch(/\b[a-z]{4,}\b/);
  });

  it("skips when heartbeat asks for rest", async () => {
    const root = await workspace();
    await writeFile(join(root, "runtime", "heartbeat-state.json"), JSON.stringify({ mood: "rest" }), "utf8");
    await expect(proposeSpawn(root, { now: new Date("2026-04-29T00:00:00.000Z") })).resolves.toBeNull();
  });

  it("rejects secret-like input context before drafting", async () => {
    const root = await workspace();
    await writeFile(join(root, "observations", "2026-04-30.md"), `do not expose ${["TELEGRAM", "BOT", "TOKEN"].join("_")}=unsafe123\n`, "utf8");

    await expect(proposeSpawn(root, { now: new Date("2026-04-30T00:00:00.000Z") })).rejects.toThrow("song_spawn_secret_like_input");
  });

  it("skips a spawn when the proposed title repeats a recent spawn theme", async () => {
    const root = await workspace();
    await registerCallbackAction(root, {
      action: "song_spawn_inject",
      commissionBrief: {
        songId: "spawn_recent",
        title: "再開発で古いライブハウスが消え、跡地に同じ色の",
        brief: "recent duplicate",
        lyricsTheme: "recent duplicate",
        mood: "observational",
        tempo: "artist decides",
        duration: "artist decides",
        styleNotes: "restrained",
        sourceText: "test",
        createdAt: "2026-04-29T00:00:00.000Z"
      },
      chatId: 1,
      messageId: 2,
      userId: 3,
      now: new Date("2026-04-29T00:30:00.000Z").getTime()
    });

    await expect(proposeSpawn(root, { aiReviewProvider: "mock", now: new Date("2026-04-29T01:00:00.000Z") })).resolves.toBeNull();
  });

  it("emits theme_starvation when observation pool is empty", async () => {
    // Plan v10.38 Phase D: observation < 12 chars should surface a starvation
    // event so the producer sees the empty pool in Telegram instead of being
    // silently shipped a hard-coded fallback title.
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-spawn-starvation-"));
    await mkdir(join(root, "observations"), { recursive: true });
    await mkdir(join(root, "runtime"), { recursive: true });
    await writeFile(join(root, "ARTIST.md"), "obsessions: 社会風刺、再開発、六本木\n", "utf8");
    await writeFile(join(root, "SOUL.md"), "mood: observational\n", "utf8");
    await writeFile(join(root, "observations", "2026-04-29.md"), "短\n", "utf8");
    await writeFile(join(root, "runtime", "heartbeat-state.json"), JSON.stringify({ mood: "observational" }), "utf8");

    const captured: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => captured.push(event));
    try {
      await expect(proposeSpawn(root, { aiReviewProvider: "mock", now: new Date("2026-04-29T00:00:00.000Z") })).resolves.toBeNull();
    } finally {
      unsubscribe();
    }
    expect(captured.some((event) => event.type === "theme_starvation" && event.source === "observation_empty")).toBe(true);
  });
});
