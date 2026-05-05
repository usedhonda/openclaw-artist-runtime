import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registerCallbackAction } from "../src/services/callbackActionRegistry";
import { proposeSpawn } from "../src/services/songSpawnProposer";

const originalBudget = process.env.OPENCLAW_SUNO_DAILY_BUDGET;

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
  afterEach(() => {
    if (originalBudget === undefined) {
      delete process.env.OPENCLAW_SUNO_DAILY_BUDGET;
    } else {
      process.env.OPENCLAW_SUNO_DAILY_BUDGET = originalBudget;
    }
  });

  it("proposes a next-song brief from observations and budget", async () => {
    const root = await workspace();
    const proposal = await proposeSpawn(root, { aiReviewProvider: "mock", now: new Date("2026-04-29T00:00:00.000Z") });

    expect(proposal?.spawn).toBe(true);
    expect(proposal?.candidateSongId).toMatch(/^spawn_/);
    expect(proposal?.brief.songId).toBe(proposal?.candidateSongId);
    expect(proposal?.brief.brief).toContain("ライブハウス");
    expect(proposal?.reason).toMatch(/[ぁ-ん一-龠]/);
    expect(proposal?.reason).not.toMatch(/\b[a-z]{4,}\b/);
  });

  it("skips when budget is too tight or heartbeat asks for rest", async () => {
    const root = await workspace();
    process.env.OPENCLAW_SUNO_DAILY_BUDGET = "1";
    await expect(proposeSpawn(root, { now: new Date("2026-04-29T00:00:00.000Z") })).resolves.toBeNull();

    delete process.env.OPENCLAW_SUNO_DAILY_BUDGET;
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
});
