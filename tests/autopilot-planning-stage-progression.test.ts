import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { readAutopilotRunState, writeAutopilotRunState, ArtistAutopilotService } from "../src/services/autopilotService";
import { readCallbackActionEntries } from "../src/services/callbackActionRegistry";
import { getRuntimeEventBus } from "../src/services/runtimeEventBus";
import { ensureSongState, readSongState, writeSongBrief } from "../src/services/artistState";
import { TelegramNotifier } from "../src/services/telegramNotifier";

function telegramResponse(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
}

async function planningWorkspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-planning-progression-"));
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

describe("autopilot planning stage progression", () => {
  afterEach(() => {
    getRuntimeEventBus().clearForTest();
    vi.restoreAllMocks();
  });

  it("auto-completes planning skeletons and advances to prompt_pack when Telegram is off", async () => {
    const root = await planningWorkspace();
    const state = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { autopilot: { enabled: true, dryRun: true }, telegram: { enabled: false } }
    });

    expect(state.stage).toBe("prompt_pack");
    expect(await readSongState(root, "planning-song")).toMatchObject({ status: "suno_prompt_pack" });
  });

  it("keeps incomplete planning skeletons out of Telegram while preserving blocked state", async () => {
    const root = await planningWorkspace();
    const fetchImpl = vi.fn().mockResolvedValue(telegramResponse({ message_id: 88, chat: { id: 123 } }));
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot: root, aiReviewProvider: "mock", fetchImpl });
    const unsubscribe = notifier.subscribe(getRuntimeEventBus());

    const state = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { autopilot: { enabled: true, dryRun: true }, telegram: { enabled: true } },
      observationRunner: async () => ({ stdout: "planning observation" })
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    unsubscribe();

    expect(state.stage).toBe("planning");
    expect(state.blockedReason).toContain("planning_skeleton_incomplete");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await readCallbackActionEntries(root)).some((entry) => entry.action === "planning_skeleton_apply")).toBe(false);
    expect((await readAutopilotRunState(root)).stage).toBe("planning");
  });

  it("keeps planning proposal skips out of Telegram and pauses stale planning states", async () => {
    const root = await planningWorkspace();
    const fetchImpl = vi.fn().mockResolvedValue(telegramResponse({ message_id: 90, chat: { id: 123 } }));
    const unsubscribe = new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot: root, aiReviewProvider: "mock", fetchImpl }).subscribe(getRuntimeEventBus());
    const skipped = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { autopilot: { enabled: true, dryRun: true, planningTimeoutDays: 7 }, telegram: { enabled: true } },
      observationRunner: async () => ({ stdout: "planning observation" })
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    unsubscribe();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await readCallbackActionEntries(root)).some((entry) => entry.action === "planning_skeleton_skip")).toBe(false);
    expect(skipped.stage).toBe("planning");

    await writeAutopilotRunState(root, {
      ...skipped,
      stage: "planning",
      currentSongId: "planning-song",
      lastRunAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z"
    });
    const paused = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { autopilot: { enabled: true, dryRun: true, planningTimeoutDays: 7 }, telegram: { enabled: false } },
      observationRunner: async () => ({ stdout: "planning observation" })
    });

    expect(paused).toMatchObject({ stage: "paused", paused: true, pausedReason: "planning_stalled_7days" });
  });
});
