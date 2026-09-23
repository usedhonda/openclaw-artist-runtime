import { mkdtempSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { routeTelegramCommand } from "../src/services/telegramCommandRouter";
import { readConversationalSession } from "../src/services/conversationalSession";

async function workspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-conv-persona-"));
  await mkdir(join(root, "artist"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), "Artist name: Before\n", "utf8");
  await writeFile(join(root, "SOUL.md"), "Conversation tone: direct\n", "utf8");
  await writeFile(join(root, "artist", "CURRENT_STATE.md"), "state\n", "utf8");
  await writeFile(join(root, "artist", "SOCIAL_VOICE.md"), "voice\n", "utf8");
  return root;
}

describe("telegram conversational persona e2e", () => {
  it("proposes a persona changeset and applies it with /yes", async () => {
    const root = await workspace();

    const proposal = await routeTelegramCommand({
      text: "/persona persona をもっと鋭く変えて",
      fromUserId: 1,
      chatId: 2,
      workspaceRoot: root
    });
    expect(proposal.responseText).toContain("Persona changes proposed");
    expect((await readConversationalSession(root, 2, 1))?.pendingChangeSet).toBeTruthy();

    const applied = await routeTelegramCommand({ text: "/yes", fromUserId: 1, chatId: 2, workspaceRoot: root });

    expect(applied.responseText).toContain("Applied.");
    expect(readFileSync(join(root, "ARTIST.md"), "utf8")).toContain("artist-runtime:persona:core:start");
  });
});
