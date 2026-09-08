import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordProductionRunBinding } from "../src/services/productionConversation";

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
    const registrations: Array<(context: { workspaceDir?: string; senderIsOwner?: boolean }) => { name: string; execute: (id: string, params: unknown) => Promise<{ details: unknown }> }> = [];
    registerSunoTools({ registerTool: (tool: unknown) => registrations.push(tool as typeof registrations[number]) });
    const factory = registrations.find((registration) => registration({}).name === "artist_suno_generate");
    expect(factory).toBeDefined();
    const tool = factory!({ senderIsOwner: true });

    const input = {
      workspaceRoot: "/tmp/prepare-boundary",
      songId: "song-1",
      expectedPayloadHash: "hash",
      expectedPackVersion: 4,
      prepareOnly: true
    };
    const [result, duplicate] = await Promise.all([tool.execute("call-1", input), tool.execute("call-2", input)]);
    expect(duplicate.details).toEqual(result.details);
    expect(deferred.generate).toHaveBeenCalledTimes(1);

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

  it("honors an append-order failed correction instead of replaying an earlier acceptance", async () => {
    const root = await mkdtemp(join(tmpdir(), "prepare-correction-"));
    await recordProductionRunBinding(root, { songId: "song-1", runId: "run-old", packVersion: 4, payloadHash: "hash", baselineStatus: "take_selected", createdAt: "2026-01-01T00:00:00Z" });
    await mkdir(join(root, "songs/song-1/suno"), { recursive: true });
    const base = { runId: "run-old", songId: "song-1", createdAt: "2026-01-01T00:00:00Z", urls: ["https://suno.com/song/old"] };
    await writeFile(join(root, "songs/song-1/suno/runs.jsonl"), [JSON.stringify({ ...base, status: "accepted" }), JSON.stringify({ ...base, status: "failed" })].join("\n") + "\n");
    deferred.generate.mockClear();
    const registrations: Array<(context: { workspaceDir?: string; senderIsOwner?: boolean }) => { name: string; execute: (id: string, params: unknown) => Promise<{ details: unknown }> }> = [];
    registerSunoTools({ registerTool: (tool: unknown) => registrations.push(tool as typeof registrations[number]) });
    const factory = registrations.find((registration) => registration({}).name === "artist_suno_generate")!;
    const result = await factory({ workspaceDir: root, senderIsOwner: true }).execute("repeat", { songId: "song-1", expectedPayloadHash: "hash", expectedPackVersion: 4, prepareOnly: true });
    expect(result.details).toMatchObject({ status: "failed", runId: "run-old" });
    expect(deferred.generate).not.toHaveBeenCalled();
  });
});
