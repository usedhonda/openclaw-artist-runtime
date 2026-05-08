import { describe, expect, it } from "vitest";
import { isAiNotConfiguredResponse } from "../src/services/aiProviderClient";

function notConfigured(provider: string): string {
  return `AI provider '${provider}' is not configured. No external model call was made.`;
}

describe("AI not-configured response helper", () => {
  it.each(["openai-codex", "openclaw", "mock", "claude-haiku"])("detects %s provider not-configured responses", (provider) => {
    expect(isAiNotConfiguredResponse(notConfigured(provider))).toBe(true);
  });

  it("does not flag normal model output or loose product text", () => {
    expect(isAiNotConfiguredResponse("title: Neon Gate\nreason: observation matched")).toBe(false);
    expect(isAiNotConfiguredResponse("")).toBe(false);
    expect(isAiNotConfiguredResponse("This product is not configured for sale")).toBe(false);
  });
});
