import { mkdir, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateArtistResponse, readArtistVoiceContext } from "../src/services/artistVoiceResponder";

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-voice-"));
}

async function writeVoiceFixture(root: string): Promise<void> {
  await mkdir(join(root, "artist"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), "# ARTIST.md\n\nArtist name: Ghost Relay\n\n## Current artist core\n\n- Core obsessions: 社会風刺\n\n## Sound\n\nCold station pop.\n\n## Places\n\n渋谷\n", "utf8");
  await writeFile(join(root, "SOUL.md"), "# SOUL.md\n\nConversation tone: short, direct, ash-road loyal.\n\n- Emotional weather: late train pressure\n", "utf8");
  await writeFile(join(root, "artist", "CURRENT_STATE.md"), "# CURRENT_STATE.md\n\n- Emotional weather: Watching late trains.\n", "utf8");
  await writeFile(join(root, "artist", "SOCIAL_VOICE.md"), "# SOCIAL_VOICE.md\n\nNo sales pitch.\n", "utf8");
}

describe("artist voice responder", () => {
  it("generates a persona-flavored mock response from context files", async () => {
    const root = makeRoot();
    await writeVoiceFixture(root);
    const context = await readArtistVoiceContext(root, { recentHistory: ["user: what are we making?"] });

    const response = await generateArtistResponse("次の曲どうする?", context, { intent: "discuss" });

    expect(response.text).toContain("社会風刺");
    expect(response.text).toContain("渋谷");
    expect(response.text).not.toContain("I heard this:");
    expect(response.text).not.toContain("次の曲どうする");
    expect(response.suggestedActions).toContain("keep_discussing");
  });

  it("blocks secret-like user input and secret-like context", async () => {
    const root = makeRoot();
    await writeVoiceFixture(root);
    const context = await readArtistVoiceContext(root);
    await expect(generateArtistResponse("API_KEY=do-not-store", context, { intent: "discuss" }))
      .rejects.toThrow("user_message_contains_secret_like_text");

    await expect(generateArtistResponse("hello", { ...context, artistMd: "COOKIE=do-not-store" }, { intent: "discuss" }))
      .rejects.toThrow("artist_context_contains_secret_like_text");
  });
});
