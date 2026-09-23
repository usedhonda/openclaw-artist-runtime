import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composeDailyVoice, hashDailyVoiceDraft } from "../src/services/artistDailyVoiceComposer";

async function workspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-daily-voice-"));
  await mkdir(join(root, "artist"), { recursive: true });
  await mkdir(join(root, "observations"), { recursive: true });
  await mkdir(join(root, "runtime"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), "Artist name: test::artist\nobsessions: 日本社会の風刺、批評、皮肉\n", "utf8");
  await writeFile(join(root, "SOUL.md"), "tone: 観察ベース、語りすぎない\n", "utf8");
  await writeFile(join(root, "observations", "2026-04-29.md"), [
    "# X Observations 2026-04-29",
    "",
    "- text: \"閉店した精肉店の張り紙が残っていた。\"",
    "  author: \"local_voice\"",
    "  url: \"https://x.com/local_voice/status/1234567890\"",
    "  postedAt: \"2026-04-29T00:00:00.000Z\""
  ].join("\n"), "utf8");
  await writeFile(join(root, "runtime", "heartbeat-state.json"), "{\"mood\":\"dry\"}\n", "utf8");
  return root;
}

describe("artist daily voice composer", () => {
  it("builds a deterministic mock draft from persona and observations", async () => {
    const root = await workspace();
    const draft = await composeDailyVoice(root, { aiReviewProvider: "mock", now: new Date("2026-04-29T12:00:00.000Z") });

    expect(draft.draftText).toContain("閉店した精肉店");
    expect(draft.draftText).toContain("https://x.com/local_voice/status/1234567890");
    expect(draft.draftText).not.toContain("#");
    expect(draft.charCount).toBeLessThanOrEqual(256);
    expect(draft.draftHash).toBe(hashDailyVoiceDraft(draft.draftText));
    expect(draft.createdAt).toBe("2026-04-29T12:00:00.000Z");
    expect(draft.selectedSource).toEqual({ author: "local_voice", url: "https://x.com/local_voice/status/1234567890" });
    expect(draft.sourceFragments.join("\n")).toContain("artist:");
  });

  it("rejects secret-like input and AI response text", async () => {
    const root = await workspace();
    await writeFile(join(root, "observations", "2026-04-30.md"), "SECRET=do-not-post\n", "utf8");
    await expect(composeDailyVoice(root, { aiReviewProvider: "mock" })).rejects.toThrow("daily_voice_input_contains_secret_like_text");
  });
});
