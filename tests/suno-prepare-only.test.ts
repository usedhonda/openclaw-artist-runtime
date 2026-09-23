import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";

const connector = vi.hoisted(() => ({
  status: vi.fn(async () => ({ state: "connected" })),
  create: vi.fn(async (input: unknown) => ({ accepted: false, runId: "run-1", reason: "prepared", urls: [], input })),
  importResults: vi.fn()
}));
vi.mock("../src/connectors/suno/resolveSunoConnector.js", () => ({ resolveSunoConnector: vi.fn(() => connector) }));

import { generateSunoRun, importSunoResults, validatePrepareOnlySubmitMode } from "../src/services/sunoRuns";
import { readProductionRunBinding } from "../src/services/productionConversation";
import { ensureSongState, readSongState, updateSongState } from "../src/services/artistState";

const payload = { songId: "fixture-song", songName: "Fixture", styleAndFeel: "minimal", excludeStyles: "noise", lyrics: "line", lyricsText: "line", payloadYaml: "line", sliders: { weirdness: 0.5, styleInfluence: 0.5, audioInfluence: 0.5 } };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function fixture(): Promise<{ root: string; payloadHash: string }> {
  const root = await mkdtemp(join(tmpdir(), "artist-prepare-only-"));
  await mkdir(join(root, "songs", "fixture-song", "suno"), { recursive: true });
  await mkdir(join(root, "songs", "fixture-song", "prompts", "prompt-pack-v001"), { recursive: true });
  await writeFile(join(root, "songs", "fixture-song", "song.md"), "# Fixture\n");
  await writeFile(join(root, "songs", "fixture-song", "suno", "suno-payload.json"), `${JSON.stringify(payload)}\n`);
  await writeFile(join(root, "songs", "fixture-song", "prompts", "prompt-pack-v001", "metadata.json"), JSON.stringify({ version: 1 }));
  return { root, payloadHash: hash(payload) };
}

const config = { autopilot: { dryRun: false }, music: { suno: { submitMode: "manual", authority: "auto_create_and_select_take", connectionMode: "browser" } } };

describe("Suno prepare-only assertion", () => {
  it("rejects prepareOnly outside manual mode", () => {
    expect(() => validatePrepareOnlySubmitMode("live", true)).toThrow("submitMode=manual");
    expect(() => validatePrepareOnlySubmitMode("skip", true)).toThrow("submitMode=manual");
    expect(() => validatePrepareOnlySubmitMode("manual", true)).not.toThrow();
  });

  it("rejects stale hash/version before connector.create", async () => {
    const { root, payloadHash } = await fixture();
    connector.create.mockClear();
    await expect(generateSunoRun({ workspaceRoot: root, songId: "fixture-song", config, workerState: "connected", expectedPayloadHash: `${payloadHash}-stale`, expectedPackVersion: 1 })).rejects.toThrow("hash mismatch");
    await expect(generateSunoRun({ workspaceRoot: root, songId: "fixture-song", config, workerState: "connected", expectedPayloadHash: payloadHash, expectedPackVersion: 2 })).rejects.toThrow("version mismatch");
    expect(connector.create).not.toHaveBeenCalled();
  });

  it("forwards prepareOnly to a manual connector after exact approval", async () => {
    const { root, payloadHash } = await fixture();
    connector.create.mockClear();
    await generateSunoRun({ workspaceRoot: root, songId: "fixture-song", config, workerState: "connected", expectedPayloadHash: payloadHash, expectedPackVersion: 1, prepareOnly: true });
    expect(connector.create).toHaveBeenCalledWith(expect.objectContaining({ prepareOnly: true }));
  });

  it("does not overwrite an archived or selected-take state for a nonaccepted prepare-only result", async () => {
    const { root, payloadHash } = await fixture();
    await ensureSongState(root, "fixture-song", "Fixture");
    await updateSongState(root, "fixture-song", { status: "archived", selectedTakeId: "take-preserved" });
    connector.create.mockResolvedValueOnce({ accepted: false, runId: "run-prepared", reason: "prepared", urls: [] });

    await generateSunoRun({ workspaceRoot: root, songId: "fixture-song", config, workerState: "connected", expectedPayloadHash: payloadHash, expectedPackVersion: 1, prepareOnly: true });

    await expect(readSongState(root, "fixture-song")).resolves.toMatchObject({ status: "archived", selectedTakeId: "take-preserved" });
  });

  it("keeps adopted audio while an exact conversational trial is generated and imported", async () => {
    const { root, payloadHash } = await fixture();
    await ensureSongState(root, "fixture-song", "Fixture");
    await updateSongState(root, "fixture-song", { status: "take_selected", selectedTakeId: "take-old" });
    connector.create.mockImplementationOnce(async (input: unknown) => ({ accepted: true, runId: (input as { runId: string }).runId, reason: "accepted", urls: ["https://suno.com/song/take-new"], input }));
    const generated = await generateSunoRun({ workspaceRoot: root, songId: "fixture-song", config, workerState: "connected", expectedPayloadHash: payloadHash, expectedPackVersion: 1, prepareOnly: true, conversational: true });
    expect(generated.status).toBe("accepted");
    expect(await readProductionRunBinding(root, "fixture-song", generated.runId)).toMatchObject({ packVersion: 1, payloadHash, baselineTake: { takeId: "take-old" } });
    await importSunoResults({ workspaceRoot: root, songId: "fixture-song", runId: generated.runId, urls: generated.urls, selectedTakeId: "take-new", config });
    expect(await readSongState(root, "fixture-song")).toMatchObject({ status: "take_selected", selectedTakeId: "take-old" });
  });
});
