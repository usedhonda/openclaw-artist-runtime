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

import { generateSunoRun, validatePrepareOnlySubmitMode } from "../src/services/sunoRuns";

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
});
