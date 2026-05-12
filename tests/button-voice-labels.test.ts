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

  // v10.27: labels are plain JA action verbs (no artist voice). Verbs may
  // reference the concrete target (file name) so third-party plugin users
  // know exactly which action runs.
  it("planningSkeleton labels are plain action verbs", () => {
    expect(buttonVoiceLabels.planningSkeleton.apply).toBe("進める");
    expect(buttonVoiceLabels.planningSkeleton.skip).toBe("中止");
    expect(buttonVoiceLabels.planningSkeleton.edit).toBe("書き直す");
  });

  it("promptPackReady labels reference concrete targets", () => {
    expect(buttonVoiceLabels.promptPackReady.go).toBe("Suno 生成へ");
    expect(buttonVoiceLabels.promptPackReady.edit).toBe("lyrics-suno.md を編集");
    expect(buttonVoiceLabels.promptPackReady.skip).toBe("保留");
  });

  it("songCompletion labels reference SONGBOOK.md target", () => {
    expect(buttonVoiceLabels.songCompletion.write).toBe("SONGBOOK.md に追記");
    expect(buttonVoiceLabels.songCompletion.later).toBe("保留");
    expect(buttonVoiceLabels.songCompletion.xPrepare).toBe("X 草案を作る");
  });

  it("dailyVoice / songSpawn / takeSelect / distribution labels are plain", () => {
    expect(buttonVoiceLabels.dailyVoice.publish).toBe("投稿");
    expect(buttonVoiceLabels.dailyVoice.edit).toBe("編集");
    expect(buttonVoiceLabels.dailyVoice.cancel).toBe("キャンセル");
    expect(buttonVoiceLabels.songSpawn.inject).toBe("採用");
    expect(buttonVoiceLabels.songSpawn.skip).toBe("スキップ");
    expect(buttonVoiceLabels.songSpawn.edit).toBe("編集");
    expect(buttonVoiceLabels.takeSelect.accept).toBe("採用");
    expect(buttonVoiceLabels.takeSelect.regenerate).toBe("再生成");
    expect(buttonVoiceLabels.takeSelect.skip).toBe("保留");
    expect(buttonVoiceLabels.distribution.apply).toBe("配信記録に反映");
    expect(buttonVoiceLabels.distribution.later).toBe("保留");
  });
});
