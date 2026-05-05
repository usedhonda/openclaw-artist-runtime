import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectEnding,
  validateAgainstVoiceContract
} from "../src/services/voiceContractValidator";
import { parseVoiceFingerprint } from "../src/services/voiceFingerprintParser";

function loadFingerprint() {
  const soul = readFileSync(join(__dirname, "..", "workspace-template", "SOUL.md"), "utf8");
  return parseVoiceFingerprint(soul);
}

describe("voiceContractValidator", () => {
  it("passes when response uses allowed endings and avoids forbidden phrases", () => {
    const fingerprint = loadFingerprint();
    const result = validateAgainstVoiceContract("聴いた。次は乾いた方で行く。", { fingerprint });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags forbidden phrases that leak into the response", () => {
    const fingerprint = loadFingerprint();
    const result = validateAgainstVoiceContract("了解しました。次の draft を出します。", { fingerprint });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.rule === "forbidden_phrase")).toBe(true);
    expect(result.violations.some((v) => v.matchedText === "了解しました")).toBe(true);
  });

  it("flags responses that end with disallowed sentence patterns", () => {
    const fingerprint = loadFingerprint();
    const result = validateAgainstVoiceContract("This is fine but not a permitted ending pattern", {
      fingerprint
    });
    expect(result.violations.some((v) => v.rule === "sentence_ending")).toBe(true);
  });

  it("flags ending repetition when the last 5 endings are identical", () => {
    const fingerprint = loadFingerprint();
    const result = validateAgainstVoiceContract("聴いた。", {
      fingerprint,
      lastEndings: ["。", "。", "。", "。", "。"]
    });
    expect(result.violations.some((v) => v.rule === "ending_repetition")).toBe(true);
  });

  it("does not flag repetition when there are fewer than 5 prior endings", () => {
    const fingerprint = loadFingerprint();
    const result = validateAgainstVoiceContract("聴いた。", {
      fingerprint,
      lastEndings: ["。", "。"]
    });
    expect(result.violations.some((v) => v.rule === "ending_repetition")).toBe(false);
  });

  it("flags producer callname drift when callname is required but missing", () => {
    const fingerprint = loadFingerprint();
    const result = validateAgainstVoiceContract("聴いた。次は乾いた方で行く。", {
      fingerprint,
      requiredCallname: true
    });
    expect(result.violations.some((v) => v.rule === "producer_callname_drift")).toBe(true);
  });

  it("passes producer callname check when callname is present", () => {
    const fingerprint = loadFingerprint();
    const result = validateAgainstVoiceContract("ゆずるさん、これ刺さるか?", {
      fingerprint,
      requiredCallname: true
    });
    expect(result.violations.some((v) => v.rule === "producer_callname_drift")).toBe(false);
  });

  it("detectEnding returns the matched ending or null", () => {
    const fingerprint = loadFingerprint();
    expect(detectEnding("聴いた。次は乾いた方で行く。", fingerprint)).toBe("。");
    expect(detectEnding("これでいい?", fingerprint)).toBe(null);
  });
});
