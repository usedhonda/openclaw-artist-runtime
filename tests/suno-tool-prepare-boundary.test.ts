import { describe, expect, it, vi } from "vitest";

const deferred = vi.hoisted(() => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((res) => { resolve = res; });
  return { promise, resolve, generate: vi.fn() };
});

vi.mock("../src/services/sunoRuns.js", () => ({
  generateSunoRun: deferred.generate
}));
vi.mock("../src/services/runtimeConfig.js", () => ({
  readResolvedConfig: vi.fn(async () => ({ music: { suno: { submitMode: "manual" } } }))
}));

import { registerSunoTools } from "../src/tools/sunoTools";

describe("artist_suno_generate prepare boundary", () => {
  it("returns prepared before the background generate promise reaches terminal state", async () => {
    deferred.generate.mockReset();
    deferred.generate.mockImplementationOnce(async (input: { onPrepared?: (info: { runId: string }) => void }) => {
      input.onPrepared?.({ runId: "run-prepared" });
      return deferred.promise;
    });
    const registrations: Array<(context: { workspaceDir?: string }) => { name: string; execute: (id: string, params: unknown) => Promise<{ details: unknown }> }> = [];
    registerSunoTools({ registerTool: (tool: unknown) => registrations.push(tool as typeof registrations[number]) });
    const factory = registrations.find((registration) => registration({}).name === "artist_suno_generate");
    expect(factory).toBeDefined();
    const tool = factory!({});

    const result = await tool.execute("call-1", {
      workspaceRoot: "/tmp/prepare-boundary",
      songId: "song-1",
      expectedPayloadHash: "hash",
      expectedPackVersion: 4,
      prepareOnly: true
    });

    expect(result.details).toEqual({
      status: "prepared",
      songId: "song-1",
      runId: "run-prepared",
      manualSubmitRequired: true,
      payloadHash: "hash",
      packVersion: 4,
      createClicked: false
    });
    let terminal = false;
    void deferred.promise.then(() => { terminal = true; });
    expect(terminal).toBe(false);
    deferred.resolve({ status: "failed" });
    await deferred.promise;
  });
});
