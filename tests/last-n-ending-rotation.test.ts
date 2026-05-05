import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composeArtistFallback } from "../src/services/artistVoiceComposer";
import { extractPersonaMotifs } from "../src/services/personaMotifExtractor";
import { detectEnding } from "../src/services/voiceContractValidator";
import { parseVoiceFingerprint } from "../src/services/voiceFingerprintParser";

function loadFingerprint() {
  const soul = readFileSync(join(__dirname, "..", "workspace-template", "SOUL.md"), "utf8");
  return parseVoiceFingerprint(soul);
}

describe("last-N ending rotation contract (Plan v10.10 Phase G)", () => {
  it("composer breaks 5-consecutive-same-ending repetition when lastEndings is supplied", () => {
    const fingerprint = loadFingerprint();
    const motifs = extractPersonaMotifs("テーマ: 社会風刺、再開発\n地理: 渋谷、Brooklyn\n");

    // Force a stuck-on-period scenario: feed 5 prior periods and ask for one more
    const lastEndings = ["。", "。", "。", "。", "。"];
    const messages = ["draft 出した", "聴いた", "次いく", "止まった", "刺さる"];
    let differentEndingCount = 0;
    for (const message of messages) {
      const text = composeArtistFallback({
        userMessage: message,
        motifs,
        userIntent: "discuss",
        voiceFingerprint: fingerprint,
        lastEndings
      });
      const ending = detectEnding(text, fingerprint);
      if (ending && ending !== "。") {
        differentEndingCount += 1;
      }
    }
    // At least one of the 5 attempts should diverge from the stuck "。" ending
    expect(differentEndingCount).toBeGreaterThanOrEqual(1);
  });

  it("composer remains stable when lastEndings has fewer than 5 entries (no rotation pressure)", () => {
    const fingerprint = loadFingerprint();
    const motifs = extractPersonaMotifs("テーマ: 社会風刺\n地理: 渋谷\n");

    const text = composeArtistFallback({
      userMessage: "聴いた",
      motifs,
      userIntent: "discuss",
      voiceFingerprint: fingerprint,
      lastEndings: ["。", "。"]
    });
    expect(text.length).toBeGreaterThan(0);
  });

  it("composer respects forbidden_phrases regardless of last-endings state", () => {
    const fingerprint = loadFingerprint();
    const motifs = extractPersonaMotifs("テーマ: 社会風刺\n地理: 渋谷\n");

    const text = composeArtistFallback({
      userMessage: "確認お願いします",
      motifs,
      userIntent: "ack",
      voiceFingerprint: fingerprint,
      lastEndings: []
    });
    for (const forbidden of fingerprint.forbiddenPhrases.slice(0, 6)) {
      expect(text).not.toContain(forbidden);
    }
  });
});
