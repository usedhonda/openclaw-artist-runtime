import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { callAiProviderMock } = vi.hoisted(() => ({ callAiProviderMock: vi.fn() }));
vi.mock("../src/services/aiProviderClient", () => ({
  callAiProvider: callAiProviderMock,
  isAiNotConfiguredResponse: (value: string) => value.includes("not configured"),
  isAiProviderMockFallbackResponse: (value: string) => value.startsWith("Mock provider fallback")
}));

import { selectNewsEditorially } from "../src/services/newsEditorialSelection";
import { collectNewsObservations } from "../src/services/newsObservationCollector";

describe("news editorial selection", () => {
  beforeEach(() => callAiProviderMock.mockReset());

  it("uses model-selected diverse candidates and sends the full bounded pool", async () => {
    const candidates = [
      { text: "NY market quote rises", source: "wire" },
      { text: "Shibuya person name event", source: "wire" },
      { text: "Residents defend a threatened community library", source: "local" },
      { text: "Night workers organize for safer transit", source: "local" }
    ];
    callAiProviderMock.mockResolvedValueOnce("[1, 3]");
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

  it("retains selected non-geographic stories through collection and caching", async () => {
    callAiProviderMock.mockResolvedValueOnce("[1, 0]");
    const result = await collectNewsObservations(mkdtempSync(join(tmpdir(), "editorial-cache-")), {
      personaText: "Places: 渋谷",
      config: { aiReview: { provider: "openai-codex" } },
      fetcher: async () => '<rss><channel><item><title>渋谷の店の閉店</title><link>https://example.com/shop</link></item><item><title>家族を介護する子供たちの放課後</title><link>https://example.com/care</link></item></channel></rss>'
    });
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].text).toContain("介護");
    expect(result.entries[0].motifScore).toBe(0);
  });

  it("does not parse a provider fallback echo as a selection", async () => {
    callAiProviderMock.mockResolvedValueOnce("Mock provider fallback: Return JSON only [2, 7, 11]");
    const result = await selectNewsEditorially("/tmp/editorial", [{ text: "story" }], { provider: "openclaw" });
    expect(result.entries).toEqual([]);
    expect(result.reason).toBe("news_editorial_selection_provider_failed");
  });
});
