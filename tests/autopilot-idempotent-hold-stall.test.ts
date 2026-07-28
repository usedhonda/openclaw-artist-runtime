import { appendFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace.js";
import { ensureSongState, readSongState, updateSongState } from "../src/services/artistState.js";
import {
  ArtistAutopilotService,
  emitIdempotentHoldOncePerDay,
  resetIdempotentHoldDedupForTest,
  writeAutopilotRunState
} from "../src/services/autopilotService.js";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus.js";

const IDEMPOTENT_HOLD_SOURCE = "autopilot_idempotent_hold";

// Append a failed Suno run to the lane's ledger, mirroring the 2026-07-28 rollback where a
// supersede(failed, urls=[]) was written after the song was reset to suno_prompt_pack.
function seedFailedSunoRun(root: string, songId: string, runId: string): void {
  const dir = join(root, "songs", songId, "suno");
  mkdirSync(dir, { recursive: true });
  const record = {
    runId,
    songId,
    createdAt: new Date().toISOString(),
    mode: "background_browser_worker",
    authorityDecision: { allowed: false, authority: "auto_create_and_select_take", reason: "superseded" },
    status: "failed",
    dryRun: false,
    urls: [] as string[]
  };
  appendFileSync(join(dir, "runs.jsonl"), `${JSON.stringify(record)}\n`);
}

function subscribeIdempotentHolds(): { events: RuntimeEvent[]; unsubscribe: () => void } {
  const events: RuntimeEvent[] = [];
  const unsubscribe = getRuntimeEventBus().subscribe((event) => {
    if (event.type === "error" && event.source === IDEMPOTENT_HOLD_SOURCE) {
      events.push(event);
    }
  });
  return { events, unsubscribe };
}

describe("autopilot idempotent-hold stall recovery", () => {
  beforeEach(() => {
    resetIdempotentHoldDedupForTest();
  });

  // Reproduces the 2026-07-28 spawn_cc1049 silent stall: the song was rolled back to
  // suno_prompt_pack while the run state kept lastSuccessfulStage=suno_generation and the
  // same runId with no block. stageFromSong maps suno_prompt_pack -> suno_generation, so the
  // same-runId idempotency guard used to hold every tick and never fired the create. The fix
  // treats suno_prompt_pack as an action-pending status and drives the create instead.
  it("self-heals a suno_prompt_pack song wedged by a stale lastSuccessfulStage=suno_generation", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-idempotent-stall-"));
    await ensureArtistWorkspace(root);
    await ensureSongState(root, "stall-song", "Stall Song");
    await updateSongState(root, "stall-song", { status: "suno_prompt_pack" });
    seedFailedSunoRun(root, "stall-song", "suno_superseded");
    await writeAutopilotRunState(root, {
      runId: "stall-run",
      currentSongId: "stall-song",
      stage: "suno_generation",
      paused: false,
      retryCount: 0,
      cycleCount: 0,
      updatedAt: new Date().toISOString(),
      lastRunAt: new Date().toISOString(),
      lastSuccessfulStage: "suno_generation"
      // No blockedReason / lastError: exactly the inconsistent post-rollback shape.
    });

    const service = new ArtistAutopilotService();
    const config = {
      artist: { workspaceRoot: root },
      autopilot: { enabled: true, dryRun: false },
      music: { suno: { driver: "mock" as const, connectionMode: "background_browser_worker" as const } },
      telegram: { enabled: false }
    };

    const next = await service.runCycle({ workspaceRoot: root, config });
    // Before the fix this returned stage "suno_generation" untouched (guard held). After the
    // fix the create path runs; with the mock driver it imports takes and advances.
    expect(next.stage).toBe("take_selection");
    expect(await readSongState(root, "stall-song")).toMatchObject({ status: "takes_imported" });
  }, 30_000);

  // When the guard legitimately holds (song status maps to an already-successful stage that
  // is not action-pending), the hold must be visible instead of silent, but collapse to at
  // most one runtime event per calendar day per song+stage so it never spams the ticker.
  it("emits a visible idempotent-hold event and dedups within the same day", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-idempotent-hold-"));
    await ensureArtistWorkspace(root);
    await ensureSongState(root, "hold-song", "Hold Song");
    await updateSongState(root, "hold-song", { status: "social_assets" });
    await writeAutopilotRunState(root, {
      runId: "hold-run",
      currentSongId: "hold-song",
      stage: "publishing",
      paused: false,
      retryCount: 0,
      cycleCount: 0,
      updatedAt: new Date().toISOString(),
      lastRunAt: new Date().toISOString(),
      lastSuccessfulStage: "publishing"
    });

    const service = new ArtistAutopilotService();
    const config = {
      artist: { workspaceRoot: root },
      autopilot: { enabled: true, dryRun: false },
      music: { suno: { driver: "mock" as const, connectionMode: "background_browser_worker" as const } },
      telegram: { enabled: false }
    };

    const { events, unsubscribe } = subscribeIdempotentHolds();
    try {
      const first = await service.runCycle({ workspaceRoot: root, config });
      expect(first.stage).toBe("publishing"); // guard held: no forward progress
      await service.runCycle({ workspaceRoot: root, config });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: "error", source: IDEMPOTENT_HOLD_SOURCE, songId: "hold-song" });
    } finally {
      unsubscribe();
    }
  }, 30_000);

  it("dedups per calendar day and separates by song+stage", () => {
    const { events, unsubscribe } = subscribeIdempotentHolds();
    try {
      const day1 = new Date("2026-07-28T04:00:00.000Z");
      const day1Later = new Date("2026-07-28T23:00:00.000Z");
      const day2 = new Date("2026-07-29T01:00:00.000Z");

      emitIdempotentHoldOncePerDay("song-a", "suno_generation", day1);
      emitIdempotentHoldOncePerDay("song-a", "suno_generation", day1Later); // same day -> deduped
      expect(events).toHaveLength(1);

      emitIdempotentHoldOncePerDay("song-a", "suno_generation", day2); // new day -> re-emits
      expect(events).toHaveLength(2);

      emitIdempotentHoldOncePerDay("song-b", "suno_generation", day1); // different song -> separate
      emitIdempotentHoldOncePerDay("song-a", "publishing", day1); // different stage -> separate
      expect(events).toHaveLength(4);
    } finally {
      unsubscribe();
    }
  });
});
