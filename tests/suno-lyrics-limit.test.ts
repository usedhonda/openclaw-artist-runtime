import { describe, expect, it } from "vitest";
import { DEFAULT_SUNO_LYRICS_BOX_LIMIT, effectiveLyricsBoxLimit } from "../src/services/runtimeConfig";

describe("Suno lyrics box limit", () => {
  it("defaults to the near-custom-box limit instead of the old 1250 cap", () => {
    expect(DEFAULT_SUNO_LYRICS_BOX_LIMIT).toBe(4800);
    expect(effectiveLyricsBoxLimit({}, {} as NodeJS.ProcessEnv)).toBe(4800);
  });

  it("honors the DOM textarea maxLength as the effective upper bound", () => {
    expect(effectiveLyricsBoxLimit({ domMaxLength: 5000 }, {} as NodeJS.ProcessEnv)).toBe(5000);
    expect(effectiveLyricsBoxLimit({ configuredLimit: 4800, domMaxLength: 5000 }, {} as NodeJS.ProcessEnv)).toBe(4800);
    expect(effectiveLyricsBoxLimit({ configuredLimit: 6000, domMaxLength: 5000 }, {} as NodeJS.ProcessEnv)).toBe(5000);
  });
});
