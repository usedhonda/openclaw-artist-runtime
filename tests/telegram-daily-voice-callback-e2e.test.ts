import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtistAutopilotService } from "../src/services/autopilotService";
import { readCallbackActionEntries } from "../src/services/callbackActionRegistry";
import { getRuntimeEventBus } from "../src/services/runtimeEventBus";
import { TelegramNotifier } from "../src/services/telegramNotifier";

const originalPulse = process.env.OPENCLAW_ARTIST_PULSE_ENABLED;

async function workspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-daily-voice-e2e-"));
  await mkdir(join(root, "artist"), { recursive: true });
  await mkdir(join(root, "observations"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), "Artist name: used::honda\nobsessions: 閉じる街の観察\n", "utf8");
  await writeFile(join(root, "SOUL.md"), "tone: 率直、短く、観察ベース\n", "utf8");
  await writeFile(join(root, "artist", "CURRENT_STATE.md"), "awake\n", "utf8");
  await writeFile(join(root, "artist", "SOCIAL_VOICE.md"), "short\n", "utf8");
  await writeFile(join(root, "observations", "2026-04-29.md"), "商店街の灯りが半分だけ消えていた。\n", "utf8");
  return root;
}

describe("telegram daily voice callback e2e", () => {
  afterEach(() => {
    if (originalPulse === undefined) {
      delete process.env.OPENCLAW_ARTIST_PULSE_ENABLED;
    } else {
      process.env.OPENCLAW_ARTIST_PULSE_ENABLED = originalPulse;
    }
    getRuntimeEventBus().clearForTest();
    vi.restoreAllMocks();
  });

  it("drafts an artist pulse without surfacing X draft buttons in Telegram", async () => {
    process.env.OPENCLAW_ARTIST_PULSE_ENABLED = "on";
    const root = await workspace();
    const fetchImpl = vi.fn();
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot: root, aiReviewProvider: "mock", fetchImpl });
    const unsubscribe = notifier.subscribe(getRuntimeEventBus());

    await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { autopilot: { enabled: false, dryRun: true } },
      observationRunner: async () => ({ stdout: "商店街の灯りが半分だけ消えていた。" })
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    unsubscribe();

    const actions = await readCallbackActionEntries(root);
    const publish = actions.find((entry) => entry.action === "daily_voice_publish");
    expect(publish).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
