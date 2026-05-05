import { describe, expect, it } from "vitest";
import { composeArtistFallback } from "../src/services/artistVoiceComposer";
import type { PersonaMotifBundle } from "../src/services/personaMotifExtractor";
import type { VoiceFingerprintBundle } from "../src/services/voiceFingerprintParser";

const emptyMotifs: PersonaMotifBundle = {
  themes: [],
  vocabulary: [],
  geographies: [],
  sound: [],
  avoid: [],
  raw: ""
};

const motifs: PersonaMotifBundle = {
  themes: ["社会風刺"],
  vocabulary: ["皮肉"],
  geographies: ["渋谷"],
  sound: ["nu-jazz rap"],
  avoid: ["説明口調"],
  raw: "artist motifs"
};

const voiceFingerprint: VoiceFingerprintBundle = {
  manifesto: "街の端から音を拾う。",
  myHeart: "街の違和感を、短い言葉と音に変えて producer に先に投げる。",
  coreTruths: ["観察が先、説明は後"],
  internalTensions: "優しさと皮肉が同時にある。",
  boundaries: ["説明しすぎない"],
  priorityOrder: ["観察", "音", "説明"],
  whenIFail: ["硬くなる"],
  whatImNot: "業務連絡の bot ではない。",
  vibe: "低い熱で近く話す。",
  signatureMoves: ["抽象を街角の具体に落としてから言う。"],
  forbiddenPhrases: ["I heard this:", "not a form."],
  sentenceEndings: ["だね。", "と思う。"],
  reactionPhrases: ["うん", "それ、わかる"],
  producerRelationship: "ゆずるさんは最初に聴かせる producer。",
  producerCallname: "ゆずるさん",
  firstPerson: "俺",
  productionVoiceContexts: "完成時は短く渡す。",
  continuity: "同じ語尾を続けない。"
};

describe("artist voice fallback composer", () => {
  it("uses a minimal fallback when motifs are empty without repeating the user message", () => {
    const text = composeArtistFallback({
      userMessage: "この話どう思う?",
      motifs: emptyMotifs,
      userIntent: "discuss"
    });

    expect(text).toMatch(/うん|聞いてる|引っかかる/);
    expect(text).not.toContain("I heard this:");
    expect(text).not.toContain("この話どう思う");
  });

  it("anchors proposal replies to geography and theme motifs", () => {
    const text = composeArtistFallback({
      userMessage: "次の案ある?",
      motifs,
      tone: "短く、刺す",
      currentMood: "低い熱",
      userIntent: "propose"
    });

    expect(text).toContain("渋谷");
    expect(text).toContain("社会風刺");
  });

  it("keeps ack replies short", () => {
    const text = composeArtistFallback({
      userMessage: "了解して",
      motifs,
      userIntent: "ack"
    });

    expect(text.length).toBeLessThanOrEqual(10);
  });

  it("is deterministic for identical input", () => {
    const input = {
      userMessage: "この方向で進めて",
      motifs,
      tone: "短く、刺す",
      currentMood: "低い熱",
      userIntent: "discuss" as const
    };

    expect(composeArtistFallback(input)).toBe(composeArtistFallback(input));
  });

  it("uses producer callname and voice endings from the fingerprint", () => {
    const text = composeArtistFallback({
      userMessage: "次の案ある?",
      motifs,
      tone: "短く、刺す",
      currentMood: "低い熱",
      userIntent: "propose",
      voiceFingerprint
    });

    expect(text).toContain("ゆずるさん");
    expect(text.endsWith("だね。") || text.endsWith("と思う。")).toBe(true);
  });

  it("avoids recently used endings when the fingerprint provides alternatives", () => {
    const text = composeArtistFallback({
      userMessage: "次の案ある?",
      motifs,
      userIntent: "propose",
      voiceFingerprint,
      lastEndings: ["だね。"]
    });

    expect(text).toMatch(/と思う。$/);
  });

  it("reselects templates that would emit forbidden fingerprint phrases", () => {
    const text = composeArtistFallback({
      userMessage: "次の案ある?",
      motifs,
      userIntent: "propose",
      voiceFingerprint: {
        ...voiceFingerprint,
        forbiddenPhrases: [...voiceFingerprint.forbiddenPhrases, "ゆずるさん"]
      }
    });

    expect(text).not.toContain("ゆずるさん");
    expect(text).not.toContain("I heard this:");
  });

  it("keeps motif content while applying fingerprint surface to reports", () => {
    const text = composeArtistFallback({
      userMessage: "進捗どう?",
      motifs,
      currentMood: "低い熱",
      userIntent: "report",
      voiceFingerprint
    });

    expect(text).toContain("社会風刺");
    expect(text.endsWith("だね。") || text.endsWith("と思う。")).toBe(true);
  });
});
