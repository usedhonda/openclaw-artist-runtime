import { describe, expect, it } from "vitest";
import { parseIntentDirectives } from "../src/services/personaMigrator";

describe("parseIntentDirectives", () => {
  it("extracts operator-style artist and soul directives", () => {
    const map = parseIntentDirectives([
      "obsessions: 日本社会の風刺、批評、皮肉",
      "socialVoice: 短く、刺さるように、過剰な売り込みは避ける",
      "soul-tone: プロデューサーに対しては率直、ぶっきらぼう、必要なら反論",
      "soul-refusal: できないことは「できない」と即答、言い訳しない"
    ].join("\n"));

    expect(map.get("obsessions")?.value).toBe("日本社会の風刺、批評、皮肉");
    expect(map.get("socialVoice")?.value).toBe("短く、刺さるように、過剰な売り込みは避ける");
    expect(map.get("soul-tone")?.value).toBe("プロデューサーに対しては率直、ぶっきらぼう、必要なら反論");
    expect(map.get("soul-refusal")?.value).toBe("できないことは「できない」と即答、言い訳しない");
  });

  it("normalizes alias variants for soul tone and artist name", () => {
    expect(parseIntentDirectives("tone: close but blunt").get("soul-tone")?.value).toBe("close but blunt");
    expect(parseIntentDirectives("conversation tone: warm static").get("soul-tone")?.value).toBe("warm static");
    expect(parseIntentDirectives("soul tone: desert radio").get("soul-tone")?.value).toBe("desert radio");
    expect(parseIntentDirectives("artist name: test::artist").get("artistName")?.value).toBe("test::artist");
    expect(parseIntentDirectives("artistName: test::artist").get("artistName")?.value).toBe("test::artist");
    expect(parseIntentDirectives("name: test::artist").get("artistName")?.value).toBe("test::artist");
  });

  it("recognizes voice aliases by exact normalized key only", () => {
    const map = parseIntentDirectives(["voice: sparse and sharp", "tone of voice: this stays attached"].join("\n"));

    expect(map.get("socialVoice")?.value).toBe("sparse and sharp\ntone of voice: this stays attached");
  });

  it("treats bare keep values and explicit skip phrases as skip directives", () => {
    const map = parseIntentDirectives([
      "artistName: keep test::artist",
      "identityLine: keep",
      "socialVoice: keep as-is, skip",
      "soul-refusal: keep as is from existing SOUL"
    ].join("\n"));

    expect(map.get("artistName")?.skip).toBe(true);
    expect(map.get("identityLine")?.skip).toBe(true);
    expect(map.get("socialVoice")?.skip).toBe(true);
    expect(map.get("soul-refusal")?.skip).toBe(true);
  });

  it("concatenates multi-line values until the next alias-matched directive", () => {
    const map = parseIntentDirectives([
      "obsessions: 日本社会の風刺",
      "アイロニーと哀愁",
      "Genre: dark folk",
      "socialVoice: 短く言う"
    ].join("\n"));

    expect(map.get("obsessions")?.value).toContain("日本社会の風刺");
    expect(map.get("obsessions")?.value).toContain("アイロニーと哀愁");
    expect(map.get("obsessions")?.value).toContain("Genre: dark folk");
    expect(map.get("socialVoice")?.value).toBe("短く言う");
  });

  it("returns an empty map for empty or unkeyed text", () => {
    expect(parseIntentDirectives("").size).toBe(0);
    expect(parseIntentDirectives("   \n\t").size).toBe(0);
    expect(parseIntentDirectives("no colon here").size).toBe(0);
  });
});
