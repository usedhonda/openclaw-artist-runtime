import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ArtistAutopilotService, readAutopilotRunState, writeAutopilotRunState } from "../src/services/autopilotService";
import { readCallbackActionEntries } from "../src/services/callbackActionRegistry";
import { getRuntimeEventBus } from "../src/services/runtimeEventBus";
import { ensureSongState, writeSongBrief } from "../src/services/artistState";
import { TelegramNotifier } from "../src/services/telegramNotifier";

function telegramResponse(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
}

async function planningWorkspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-planning-dedup-"));
  await ensureArtistWorkspace(root);
  await ensureSongState(root, "planning-song", "Planning Song");
  await writeSongBrief(root, "planning-song", "# Brief\n\n- Mood: cold");
  await writeAutopilotRunState(root, {
    runId: "run-planning",
    currentSongId: "planning-song",
    stage: "planning",
    paused: false,
    retryCount: 0,
    cycleCount: 0,
    lastRunAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastSuccessfulStage: "planning"
  });
  return root;
}

describe("planning_skeleton_incomplete dedup", () => {
  afterEach(() => {
    getRuntimeEventBus().clearForTest();
    vi.restoreAllMocks();
  });

  it("emits only one planning_skeleton_incomplete event for the same song across consecutive cycles", async () => {
    const root = await planningWorkspace();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(telegramResponse({ message_id: 88, chat: { id: 123 } }))
      .mockResolvedValueOnce(telegramResponse(true));
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot: root, aiReviewProvider: "mock", fetchImpl });
    const unsubscribe = notifier.subscribe(getRuntimeEventBus());

    const service = new ArtistAutopilotService();
    const firstState = await service.runCycle({
      workspaceRoot: root,
      config: { autopilot: { enabled: true, dryRun: true }, telegram: { enabled: true } },
      observationRunner: async () => ({ stdout: "planning observation" })
    });
    await vi.waitFor(async () => {
      expect((await readCallbackActionEntries(root)).some((entry) => entry.action === "planning_skeleton_apply")).toBe(true);
    });

    expect(firstState.suspendedAt).toBe("planning_skeleton_pending");
    const entriesAfterFirst = await readCallbackActionEntries(root);
    const planningProposalsAfterFirst = entriesAfterFirst.filter((entry) => entry.action === "planning_skeleton_apply").length;
    expect(planningProposalsAfterFirst).toBe(1);

    const secondState = await service.runCycle({
      workspaceRoot: root,
      config: { autopilot: { enabled: true, dryRun: true }, telegram: { enabled: true } },
      observationRunner: async () => ({ stdout: "planning observation" })
    });
    expect(secondState.suspendedAt).toBe("planning_skeleton_pending");

    const entriesAfterSecond = await readCallbackActionEntries(root);
    const planningProposalsAfterSecond = entriesAfterSecond.filter((entry) => entry.action === "planning_skeleton_apply").length;
    expect(planningProposalsAfterSecond).toBe(1);

    unsubscribe();
  });

  it("clears suspendedAt when planning becomes complete", async () => {
    const root = await planningWorkspace();
    await writeAutopilotRunState(root, {
      ...(await readAutopilotRunState(root)),
      suspendedAt: "planning_skeleton_pending",
      blockedReason: "planning_skeleton_incomplete:tempo,duration"
    });

    await writeSongBrief(root, "planning-song", "# Brief\n\n- Mood: cold\n- Tempo: 92 BPM\n- Duration: 180 seconds\n- Style notes: nu-jazz rap\n- Lyrics theme: city");

    const service = new ArtistAutopilotService();
    const state = await service.runCycle({
      workspaceRoot: root,
      config: { autopilot: { enabled: true, dryRun: true }, telegram: { enabled: false } }
    });
    expect(state.suspendedAt).toBeFalsy();
  });
});
