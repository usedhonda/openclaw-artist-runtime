import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { listSongStates } from "../src/services/artistState";
import { ArtistAutopilotService } from "../src/services/autopilotService";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-observation-gate-"));
}

// A runner that fails every attempt drives collectObservations to status "skipped"
// with empty observations -- the "no news/X material" condition the gate guards.
const failingRunner = vi.fn(async () => {
  throw new Error("bird_unavailable_in_test");
});

function jstDateToday(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Reproduce the tonight scenario: proposeSpawn returns a non-null proposal (the
// observation raw text clears the >=12-char starvation guard) but the director gets
// no qualifying observation summary (the entry has no full tweet URL / author), so
// the CreativeDecision carries observation_null with no sources -- a bank-only song.
async function spawnReadyWithUnusableObservation(root: string): Promise<void> {
  await writeFile(join(root, "ARTIST.md"), "obsessions: 再開発の経済合理性、夜の街、皮肉\n", "utf8");
  await writeFile(join(root, "SOUL.md"), "mood: observational\n", "utf8");
  await mkdir(join(root, "runtime"), { recursive: true });
  await writeFile(join(root, "runtime", "heartbeat-state.json"), JSON.stringify({ mood: "observational" }), "utf8");
  await mkdir(join(root, "observations"), { recursive: true });
  await writeFile(
    join(root, "observations", `${jstDateToday()}.md`),
    "- 再開発で古いライブハウスが消え、跡地に同じ色の看板だけが増えた街の温度。\n",
    "utf8"
  );
}

describe("autopilot observation materialization gate", () => {
  afterEach(() => {
    failingRunner.mockClear();
    vi.unstubAllEnvs();
  });

  it("holds instead of materializing a bank-only song when no observation exists", async () => {
    const root = workspace();
    await ensureArtistWorkspace(root);

    const state = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: {
        artist: { workspaceRoot: root },
        autopilot: { enabled: true, dryRun: true, songsPerWeek: 50 },
        songSpawn: { enabled: false }
      },
      observationRunner: failingRunner
    });

    expect(state.blockedReason).toBe("observation_unavailable");
    expect(state.currentSongId).toBeUndefined();
    expect(await listSongStates(root)).toHaveLength(0);
  });

  it("materializes a bank-driven song when manualSeed opts in with allowNoObservation", async () => {
    const root = workspace();
    await ensureArtistWorkspace(root);

    const state = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: {
        artist: { workspaceRoot: root },
        autopilot: { enabled: true, dryRun: true, songsPerWeek: 50 },
        songSpawn: { enabled: false }
      },
      manualSeed: { hint: "bank-driven dopagaki variation", allowNoObservation: true },
      observationRunner: failingRunner
    });

    expect(state.blockedReason).not.toBe("observation_unavailable");
    expect(state.currentSongId).toBeTruthy();
    expect((await listSongStates(root)).length).toBeGreaterThan(0);
  });

  it("holds the autonomous spawn lane when the proposal has no news/X material", async () => {
    const root = workspace();
    await ensureArtistWorkspace(root);
    await spawnReadyWithUnusableObservation(root);

    const state = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: {
        artist: { workspaceRoot: root },
        autopilot: { enabled: true, dryRun: true, songsPerWeek: 50 },
        songSpawn: { enabled: true }
      },
      observationRunner: failingRunner
    });

    expect(state.blockedReason).toBe("observation_unavailable");
    expect(state.currentSongId).toBeUndefined();
    expect(await listSongStates(root)).toHaveLength(0);
  });
});
