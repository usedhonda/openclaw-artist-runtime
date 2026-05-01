import { describe, expect, it } from "vitest";
import { extractLyricsBody } from "../src/services/lyricsExtraction";

describe("extractLyricsBody", () => {
  it("returns only content between explicit lyrics markers", () => {
    const yaml = [
      "# META",
      "title: Plain Signal",
      "=== LYRICS START ===",
      "",
      "line one",
      "line two",
      "",
      "=== LYRICS END ==="
    ].join("\n");

    expect(extractLyricsBody(yaml)).toBe("line one\nline two");
  });

  it("supports current generated lyrics markers", () => {
    const yaml = ["# META", "title: Plain Signal", "LYRICS START", "line one", "LYRICS END"].join("\n");

    expect(extractLyricsBody(yaml)).toBe("line one");
  });

  it("returns input unchanged when markers are absent", () => {
    const input = "line one\nline two";

    expect(extractLyricsBody(input)).toBe(input);
  });
});
