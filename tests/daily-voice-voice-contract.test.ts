import { mkdtempSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composeDailyVoice } from "../src/services/artistDailyVoiceComposer";

/**
 * Plan v10.11 Phase D-AB:
 * composeDailyVoice must thread through the voice fingerprint pipeline so the
 * resulting tweet draft cannot leak forbidden phrases or English-only prose.
 * The mock branch keeps the legacy 4-field shape but the composer fallback
 * (used by the AI branch via generateArtistResponse) must not emit forbidden
 * lines, and the rationale must remain Japanese.
 */

async function workspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-daily-voice-vc-"));
  await mkdir(join(root, "observations"), { recursive: true });
  await mkdir(join(root, "runtime"), { recursive: true });

  const templateRoot = join(__dirname, "..", "workspace-template");
  const [soul, artist, identity, inner, producer] = await Promise.all([
    readFile(join(templateRoot, "SOUL.md"), "utf8"),
    readFile(join(templateRoot, "ARTIST.md"), "utf8"),
    readFile(join(templateRoot, "IDENTITY.md"), "utf8"),
    readFile(join(templateRoot, "INNER.md"), "utf8"),
    readFile(join(templateRoot, "PRODUCER.md"), "utf8")
  ]);

  await writeFile(join(root, "SOUL.md"), soul, "utf8");
  await writeFile(join(root, "ARTIST.md"), artist, "utf8");
  await writeFile(join(root, "IDENTITY.md"), identity, "utf8");
  await writeFile(join(root, "INNER.md"), inner, "utf8");
  await writeFile(join(root, "PRODUCER.md"), producer, "utf8");

  await writeFile(
    join(root, "observations", "2026-05-05.md"),
    [
      "- text: \"@capt_copperman 会議室で 80 ページの資料を読み終わった夜、Brooklyn の地下で 5 拍子が鳴る\"",
      "  author: \"capt_copperman\"",
      "  url: \"https://x.com/capt_copperman/status/1\"",
      "  postedAt: \"2026-05-05T12:00:00.000Z\""
    ].join("\n"),
    "utf8"
  );
  await writeFile(join(root, "runtime", "heartbeat-state.json"), JSON.stringify({ mood: "observational" }), "utf8");
  return root;
}

describe("daily voice voice-contract (Plan v10.11)", () => {
  it("mock provider produces JP rationale anchored in SOUL/ARTIST", async () => {
    const root = await workspace();
    const draft = await composeDailyVoice(root, { aiReviewProvider: "mock" });

    expect(draft.draftText).toBeTruthy();
    expect(draft.rationale).toMatch(/[ぁ-ん一-龠]/);
    // forbidden phrases from workspace-template SOUL.md should not appear
    const forbidden = ["了解しました", "申し訳ございません", "ご確認ください"];
    for (const phrase of forbidden) {
      expect(draft.draftText).not.toContain(phrase);
    }
  });

  it("returns the selected source URL when an observation provides one", async () => {
    const root = await workspace();
    const draft = await composeDailyVoice(root, { aiReviewProvider: "mock" });
    expect(draft.selectedSource?.url).toBe("https://x.com/capt_copperman/status/1");
  });
});
