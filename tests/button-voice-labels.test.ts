import { describe, expect, it } from "vitest";
import { buttonVoiceLabels } from "../src/services/buttonVoiceLabels";

const MECHANICAL_PATTERNS = [
  /^(?:✓\s*)?Yes$/i,
  /^(?:✗\s*)?No$/i,
  /^(?:✏️?\s*)?Edit$/i,
  /^OK$/i,
  /^Cancel$/i
];

const ALL_LABELS = Object.values(buttonVoiceLabels).flatMap((group) => Object.values(group));

describe("buttonVoiceLabels", () => {
  it("has no empty labels", () => {
    for (const label of ALL_LABELS) {
      expect(label.trim().length).toBeGreaterThan(0);
    }
  });

  it("has no purely emoji or single-char labels", () => {
    for (const label of ALL_LABELS) {
      const stripped = label.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\s✓✗▶⏸✏↻📝]/gu, "").trim();
      expect(stripped.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("has no English mechanical labels (Yes/No/Edit/OK/Cancel)", () => {
    for (const label of ALL_LABELS) {
      for (const pattern of MECHANICAL_PATTERNS) {
        expect(label).not.toMatch(pattern);
      }
    }
  });

  it("planningSkeleton labels read like producer-room voice", () => {
    expect(buttonVoiceLabels.planningSkeleton.apply).toBe("いいね、 進めて");
    expect(buttonVoiceLabels.planningSkeleton.skip).toBe("やめとく");
    expect(buttonVoiceLabels.planningSkeleton.edit).toBe("書き直す");
  });

  it("promptPackReady labels stay conversational", () => {
    expect(buttonVoiceLabels.promptPackReady.go).toBe("Suno 行く");
    expect(buttonVoiceLabels.promptPackReady.edit).toBe("歌詞、 直す");
    expect(buttonVoiceLabels.promptPackReady.skip).toBe("あとで");
  });
});
