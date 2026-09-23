import { describe, expect, it, vi } from "vitest";
import { callAiProvider } from "../src/services/aiProviderClient.js";
import { callOpenClawAiRuntime, type OpenClawAiRuntime } from "../src/services/openClawAiRuntime.js";

function runtimeWithThinkingDefault(thinkingDefault: string) {
  const complete = vi.fn(async () => ({ text: "ok" }));
  const runtime: OpenClawAiRuntime = {
    subagent: {
      run: vi.fn(),
      waitForRun: vi.fn(),
      getSessionMessages: vi.fn()
    },
    llm: { complete },
    config: { current: () => ({ agents: { defaults: { thinkingDefault } } }) }
  };
  return { runtime, complete };
}

describe("OpenClaw native runtime reasoning effort", () => {
  it("uses the host thinkingDefault when the caller does not override", async () => {
    const { runtime, complete } = runtimeWithThinkingDefault("medium");

    await callOpenClawAiRuntime(runtime, "prompt", 1000);

    expect(complete).toHaveBeenCalledOnce();
    expect(complete.mock.calls[0]?.[0]).toMatchObject({ reasoning: "medium" });
  });

  it("lets a per-call override win over the host thinkingDefault", async () => {
    const { runtime, complete } = runtimeWithThinkingDefault("medium");

    await callOpenClawAiRuntime(runtime, "prompt", 1000, "xhigh");

    expect(complete.mock.calls[0]?.[0]).toMatchObject({ reasoning: "xhigh" });
  });

  it("forwards callAiProvider's reasoningEffort into the native runtime call", async () => {
    const { runtime, complete } = runtimeWithThinkingDefault("medium");

    const text = await callAiProvider("write lyrics", { provider: "openai-codex", runtime, reasoningEffort: "xhigh" });

    expect(text).toBe("ok");
    expect(complete.mock.calls[0]?.[0]).toMatchObject({ reasoning: "xhigh" });
  });
});
