import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { routeTelegramCommand } from "../src/services/telegramCommandRouter";
import { readConversationalSession } from "../src/services/conversationalSession";

async function workspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-natural-message-"));
  await mkdir(join(root, "artist"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), "Artist name: Ash Unit\n\n## Current artist core\n- Core obsessions: 社会風刺\n\n渋谷\n", "utf8");
  await writeFile(join(root, "SOUL.md"), "Conversation tone: blunt\n", "utf8");
  await writeFile(join(root, "artist", "CURRENT_STATE.md"), "awake\n", "utf8");
  await writeFile(join(root, "artist", "SOCIAL_VOICE.md"), "short\n", "utf8");
  return root;
}

describe("telegram natural message conversational entry", () => {
  it("routes prefix-free messages to artist voice and stores conversation state", async () => {
    const root = await workspace();

    const result = await routeTelegramCommand({
      text: "今日は何を作る気分?",
      fromUserId: 1,
      chatId: 2,
      workspaceRoot: root
    });

    expect(result.responseText).toContain("社会風刺");
    expect(result.responseText).not.toContain("I heard this:");
    expect(result.shouldStoreFreeText).toBe(true);
    const session = await readConversationalSession(root, 2, 1);
    expect(session?.history.map((turn) => turn.role)).toEqual(["user", "artist"]);
  });
});
