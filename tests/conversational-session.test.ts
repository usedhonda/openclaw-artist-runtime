import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendConversationTurn,
  clearConversationalSession,
  conversationalSessionPath,
  createConversationalSession,
  readConversationalSession
} from "../src/services/conversationalSession";

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-conversation-"));
}

describe("conversational session", () => {
  it("persists multi-turn state and rotates history to the latest 10 turns", async () => {
    const root = makeRoot();
    await createConversationalSession(root, { chatId: 1, userId: 2, topic: { kind: "song", songId: "song-1" }, now: 100 });
    for (let index = 0; index < 12; index += 1) {
      await appendConversationTurn(root, {
        chatId: 1,
        userId: 2,
        turn: { role: index % 2 === 0 ? "user" : "artist", text: `turn-${index}` },
        now: 101 + index
      });
    }

    const session = await readConversationalSession(root, 1, 2, 200);
    expect(session?.topic).toEqual({ kind: "song", songId: "song-1" });
    expect(session?.history).toHaveLength(10);
    expect(session?.history[0]?.text).toBe("turn-2");
    await expect(readFile(conversationalSessionPath(root), "utf8")).resolves.toContain("turn-11");
  });

  it("keeps pending ChangeSet state and clears a chat session", async () => {
    const root = makeRoot();
    await appendConversationTurn(root, {
      chatId: 10,
      userId: 20,
      turn: { role: "user", text: "save this lyric" },
      pendingChangeSet: {
        id: "changeset-test",
        domain: "song",
        summary: "Change a note.",
        fields: [],
        warnings: [],
        createdAt: "2026-04-29T00:00:00.000Z",
        source: "conversation"
      },
      now: 100
    });

    expect((await readConversationalSession(root, 10, 20, 101))?.pendingChangeSet?.id).toBe("changeset-test");
    await clearConversationalSession(root, 10, 20);
    await expect(readConversationalSession(root, 10, 20, 102)).resolves.toBeUndefined();
  });
});
