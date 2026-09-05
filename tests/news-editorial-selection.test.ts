import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { callAiProviderMock } = vi.hoisted(() => ({ callAiProviderMock: vi.fn() }));
vi.mock("../src/services/aiProviderClient", () => ({
  callAiProvider: callAiProviderMock,
  isAiNotConfiguredResponse: (value: string) => value.includes("not configured")
}));

import { selectNewsEditorially } from "../src/services/newsEditorialSelection";

describe("news editorial selection", () => {
  beforeEach(() => callAiProviderMock.mockReset());

  it("uses model-selected diverse candidates and sends the full bounded pool", async () => {
    const candidates = [
      { text: "NY market quote rises", source: "wire" },
      { text: "Shibuya person name event", source: "wire" },
      { text: "Residents defend a threatened community library", source: "local" },
      { text: "Night workers organize for safer transit", source: "local" }
    ];
    callAiProviderMock.mockResolvedValueOnce("[2, 3]");
    const result = await selectNewsEditorially(mkdtempSync(join(tmpdir(), "editorial-")), candidates, {
      provider: "openai-codex",
      personaText: "social observation"
    });
    expect(result.entries).toEqual([candidates[2], candidates[3]]);
    expect(callAiProviderMock).toHaveBeenCalledOnce();
    expect(String(callAiProviderMock.mock.calls[0]?.[0])).toContain("[0] headline/excerpt: NY market quote rises");
  });

  it("fails closed on an invalid model selection", async () => {
    callAiProviderMock.mockResolvedValueOnce("[99]");
    const result = await selectNewsEditorially("/tmp/editorial", [{ text: "story" }], { provider: "openclaw" });
    expect(result.entries).toEqual([]);
    expect(result.reason).toBe("news_editorial_selection_invalid_indices");
  });
});
