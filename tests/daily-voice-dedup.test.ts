import { describe, expect, it } from "vitest";
import { fitDailyVoiceDraft } from "../src/services/artistDailyVoiceComposer";

describe("daily voice repeated sentence dedup", () => {
  it("collapses consecutive repeated sentences", () => {
    const sentence = "偉い人ほど会議室よりグルチャで国を動かしてる感じ。";
    expect(fitDailyVoiceDraft(`${sentence}${sentence}`)).toBe(sentence);
  });

  it("keeps non-consecutive repeated sentences", () => {
    const first = "偉い人ほど会議室よりグルチャで国を動かしてる感じ。";
    const middle = "稟議書は神棚、既読は判決。";
    expect(fitDailyVoiceDraft(`${first}${middle}${first}`)).toBe(`${first}${middle}${first}`);
  });
});
