import { mkdtempSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSongSkeleton } from "../src/repositories/songRepository";
import { updateSongState } from "../src/services/artistState";
import { routeTelegramCommand } from "../src/services/telegramCommandRouter";

async function workspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-conv-song-"));
  await mkdir(join(root, "artist"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), "Artist name: Song Unit\n", "utf8");
  await writeFile(join(root, "SOUL.md"), "Conversation tone: direct\n", "utf8");
  await writeFile(join(root, "artist", "CURRENT_STATE.md"), "state\n", "utf8");
  await writeFile(join(root, "artist", "SOCIAL_VOICE.md"), "voice\n", "utf8");
  await writeFile(join(root, "artist", "SONGBOOK.md"), "# SONGBOOK.md\n", "utf8");
  await createSongSkeleton(root, "where-it-played");
  await updateSongState(root, "where-it-played", { title: "Where It Played", status: "brief" });
  return root;
}

describe("telegram conversational song e2e", () => {
  it("discusses a song and applies lyrics change through /yes", async () => {
    const root = await workspace();

    const proposal = await routeTelegramCommand({
      text: "/song where-it-played lyrics をもっと短く変えて",
      fromUserId: 1,
      chatId: 2,
      workspaceRoot: root
    });
    expect(proposal.responseText).toContain("Song changes proposed");

    const applied = await routeTelegramCommand({ text: "/yes", fromUserId: 1, chatId: 2, workspaceRoot: root });

    expect(applied.responseText).toContain("Applied.");
    expect(readFileSync(join(root, "songs", "where-it-played", "lyrics", "lyrics.v1.md"), "utf8")).toBeTruthy();
  });
});
