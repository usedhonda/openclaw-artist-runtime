import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { validateConfig } from "../src/config/schema";
import { updateSongState, writeSongBrief } from "../src/services/artistState";
import { createDebugAiReviewer, reviewSongDebugMaterial } from "../src/services/debugAiReviewService";
import { readSongMaterial } from "../src/services/songMaterialReader";
import { TelegramBotWorker } from "../src/services/telegramBotWorker";
import { routeTelegramCommand } from "../src/services/telegramCommandRouter";

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-debug-review-"));
}

async function seedSong(root: string, songId = "song-001"): Promise<void> {
  await writeSongBrief(root, songId, "# Brief\n\nStatic-burn highway hymn.");
  await mkdir(join(root, "songs", songId, "lyrics"), { recursive: true });
  await writeFile(join(root, "songs", songId, "lyrics", "lyrics.v1.md"), "first draft", "utf8");
  await writeFile(join(root, "songs", songId, "lyrics", "lyrics.v2.md"), "latest lyric", "utf8");
  await mkdir(join(root, "songs", songId, "suno"), { recursive: true });
  await writeFile(
    join(root, "songs", songId, "suno", "latest-results.json"),
    `${JSON.stringify({ takes: [{ id: "take-a", title: "Take A" }, { id: "take-b", title: "Take B" }] })}\n`,
    "utf8"
  );
  await writeFile(join(root, "songs", songId, "suno", "selected-take.json"), `${JSON.stringify({ id: "take-a" })}\n`, "utf8");
  await mkdir(join(root, "songs", songId, "prompts", "prompt-pack-v001"), { recursive: true });
  await writeFile(join(root, "songs", songId, "prompts", "prompt-pack-v001", "metadata.json"), `${JSON.stringify({ version: 1 })}\n`, "utf8");
  await updateSongState(root, songId, {
    status: "take_selected",
    selectedTakeId: "take-a",
    reason: "test"
  });
}

describe("debug AI review service", () => {
  it("reads only song material needed for debug review", async () => {
    const root = makeRoot();
    await seedSong(root);

    const material = await readSongMaterial(root, "song-001");

    expect(material.brief).toContain("Static-burn");
    expect(material.lyrics).toBe("latest lyric");
    expect(material.takes).toHaveLength(2);
    expect(material.selectedTake).toMatchObject({ id: "take-a" });
    expect(material.promptPackSummary).toMatchObject({ version: 1 });
    expect(JSON.stringify(material)).not.toMatch(/TELEGRAM_BOT_TOKEN|cookie|config-overrides|social-credentials/i);
  });

  it("returns a mock review and persists it without changing selected take", async () => {
    const root = makeRoot();
    await seedSong(root);
    const before = await readFile(join(root, "songs", "song-001", "suno", "selected-take.json"), "utf8");

    const result = await reviewSongDebugMaterial(root, await readSongMaterial(root, "song-001"), "mock");
    const after = await readFile(join(root, "songs", "song-001", "suno", "selected-take.json"), "utf8");
    const reviewFiles = await readdir(join(root, "runtime", "debug-ai-reviews"));

    expect(result.provider).toBe("mock");
    expect(result.summary).toContain("No take selection was changed");
    expect(result.outputPath).toContain("runtime/debug-ai-reviews/song-001-");
    expect(reviewFiles).toHaveLength(1);
    expect(after).toBe(before);
  });

  it("keeps unconfigured providers fail-closed without external calls", async () => {
    const reviewer = createDebugAiReviewer("openclaw");
    const result = await reviewer.review({
      songId: "song-001",
      title: "Song",
      takes: []
    });

    expect(result.provider).toBe("not_configured");
    expect(result.summary).toContain("not configured");
    expect(result.score).toBe(0);
  });

  it("routes /review unknown song to a safe message", async () => {
    const result = await routeTelegramCommand({
      text: "/review missing-song",
      fromUserId: 1,
      chatId: 2,
      workspaceRoot: makeRoot()
    });

    expect(result.kind).toBe("review");
    expect(result.responseText).toContain("unavailable");
  });

  it("replies to /review through Telegram worker with mock fetch", async () => {
    const root = makeRoot();
    await seedSong(root);
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/getUpdates")) {
        return new Response(JSON.stringify({
          ok: true,
          result: [{
            update_id: 10,
            message: { message_id: 1, chat: { id: 99 }, from: { id: 123 }, text: "/review song-001" }
          }]
        }));
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: 2 } }));
    });

    const worker = new TelegramBotWorker({
      root,
      config: { enabled: true, pollIntervalMs: 1000, notifyStages: true, acceptFreeText: true },
      token: "token",
      ownerUserIds: new Set(["123"]),
      fetchImpl,
      aiReviewProvider: "mock"
    });
    await worker.pollOnce();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body as string)).toMatchObject({
      text: expect.stringContaining("Debug review: song-001")
    });
  });

  it("validates aiReview provider config", () => {
    expect(validateConfig({ aiReview: { provider: "mock" } }).ok).toBe(true);
    expect(validateConfig({ aiReview: { provider: "not-real" } }).ok).toBe(false);
  });
});
