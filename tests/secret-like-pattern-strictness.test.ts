import { describe, expect, it } from "vitest";
import { secretLikePattern } from "../src/services/personaMigrator";

describe("secretLikePattern strictness", () => {
  it("does not flag persona prose that only names credential concepts", () => {
    const safeProse = [
      "API key、cookie、token、実行ログ",
      "password を扱わない",
      "secret という単語は説明文として使う",
      "no COOKIE storage, no token logging"
    ];

    for (const line of safeProse) {
      expect(secretLikePattern.test(line), line).toBe(false);
    }
  });

  it("flags credential-like values and Telegram bot tokens", () => {
    const unsafeValues = [
      "API_KEY=xyz123abc",
      "PASSWORD=secret123",
      "TOKEN: abcdefgh1234",
      `${["TELEGRAM", "BOT", "TOKEN"].join("_")}=123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef`,
      `bot123456:${"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghiJKLMN"}`
    ];

    for (const line of unsafeValues) {
      expect(secretLikePattern.test(line), line).toBe(true);
    }
  });
});
