import { describe, expect, it } from "vitest";
import { summarizeLyricsDegradedReason } from "../src/services/lyricsDegradedSummary";
import { formatRuntimeEvent } from "../src/services/telegramNotifier";

// Reproduces the producer-facing failure: a real prompt-pack validation dump of
// 37 residual_kanji errors that used to be pasted verbatim into Telegram.
function residualKanjiDump(count: number): string {
  const tokens = ["数字", "逃", "鳴", "値", "送電", "見下", "札"];
  const errors: string[] = [];
  for (let i = 0; i < count; i += 1) {
    errors.push(`residual_kanji:${tokens[i % tokens.length]}:line_${i + 1}`);
  }
  return errors.join("; ");
}

describe("summarizeLyricsDegradedReason", () => {
  it("summarizes a 37-token residual_kanji dump to a count plus <=3 examples", () => {
    const dump = residualKanjiDump(37);
    const summary = summarizeLyricsDegradedReason(`lyrics_generation_degraded: suno_prompt_pack_invalid: ${dump}`, dump);
    expect(summary).toContain("漢字37箇所");
    // No raw lint identifiers or line numbers leak into the producer copy.
    expect(summary).not.toMatch(/residual_kanji/);
    expect(summary).not.toMatch(/line_\d+/);
    // At most 3 unique examples are shown.
    const examples = summary.match(/例: ([^）]+)/)?.[1] ?? "";
    expect(examples.split(" / ").length).toBeLessThanOrEqual(3);
  });

  it("summarizes ascii numbers with a hiragana-reading hint", () => {
    const dump = "ascii_number:145:line_16; ascii_number:3000:line_20";
    const summary = summarizeLyricsDegradedReason(dump, dump);
    expect(summary).toContain("数字2箇所");
    expect(summary).not.toMatch(/ascii_number/);
  });

  it("combines kanji and number classes when both are present", () => {
    const dump = "residual_kanji:逃:line_20; ascii_number:145:line_16";
    const summary = summarizeLyricsDegradedReason(dump, dump);
    expect(summary).toContain("漢字1箇所");
    expect(summary).toContain("数字1箇所");
  });

  it("maps non-token failure classes to plain language", () => {
    expect(summarizeLyricsDegradedReason("lyrics_too_long_for_suno_box: lyric body 3600/3400")).toContain("上限を超えた");
    expect(summarizeLyricsDegradedReason("styleAndFeel core exceeds canonical cap: 931/120")).toContain("雰囲気メモ");
    expect(summarizeLyricsDegradedReason("some unmapped failure")).toContain("直せない点が残った");
  });

  it("still summarizes underlying tokens when wrapped by parked_needs_operator", () => {
    const dump = residualKanjiDump(5);
    const reason = `parked_needs_operator: lyrics_generation_degraded: suno_prompt_pack_invalid: ${dump}`;
    const summary = summarizeLyricsDegradedReason(reason, "parked_needs_operator:spawn_716d44");
    expect(summary).toContain("漢字5箇所");
    expect(summary).not.toMatch(/parked_needs_operator/);
  });
});

describe("lyrics_generation_degraded Telegram formatting", () => {
  it("never pastes the raw validator dump into the producer message", async () => {
    const dump = residualKanjiDump(37);
    const text = await formatRuntimeEvent({
      type: "lyrics_generation_degraded",
      songId: "spawn_716d44",
      reason: `lyrics_generation_degraded: suno_prompt_pack_invalid: ${dump}`,
      detail: dump,
      timestamp: 1
    });
    expect(text).not.toMatch(/residual_kanji/);
    expect(text).not.toMatch(/line_\d+/);
    expect(text).toContain("漢字37箇所");
    expect(text).toContain("song: spawn_716d44");
    expect(text).toContain("Producer Console");
  });

  it("uses the terminal wording once a song is parked", async () => {
    const text = await formatRuntimeEvent({
      type: "lyrics_generation_degraded",
      songId: "spawn_716d44",
      reason: "parked_needs_operator: lyrics_generation_degraded: suno_prompt_pack_invalid: residual_kanji:逃:line_20",
      detail: "parked_needs_operator:spawn_716d44",
      timestamp: 1
    });
    expect(text).toContain("一旦保留にした");
  });
});
