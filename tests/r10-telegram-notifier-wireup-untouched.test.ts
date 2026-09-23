import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRuntimeEventBus } from "../src/services/runtimeEventBus";
import { readResolvedConfig } from "../src/services/runtimeConfig";
import { startTelegramNotifierFromEnv, stopTelegramNotifierSubscriptions } from "../src/services";

function fetchOk() {
  return vi.fn(async (input: string) => ({
    ok: true,
    json: async () => ({
      ok: true,
      result: String(input).includes("/sendMessage") ? { message_id: 7, chat: { id: 123 }, date: 0, text: "ok" } : true
    })
  })) as unknown as typeof fetch;
}

describe("R10 telegram notifier wireup boundary", () => {
  afterEach(() => {
    stopTelegramNotifierSubscriptions();
    getRuntimeEventBus().clearForTest();
    vi.unstubAllGlobals();
  });

  it("subscribes and forwards events without changing dry-run or live arm flags", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-r10-notifier-"));
    vi.stubGlobal("fetch", fetchOk());
    const before = await readResolvedConfig(root);

    await startTelegramNotifierFromEnv({
      OPENCLAW_LOCAL_WORKSPACE: root,
      TELEGRAM_BOT_TOKEN: "mock-token",
      TELEGRAM_OWNER_USER_IDS: "123"
    } as NodeJS.ProcessEnv);
    getRuntimeEventBus().emit({
      type: "song_take_completed",
      songId: "song-001",
      urls: ["https://suno.com/song/a"],
      timestamp: Date.now()
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());

    const after = await readResolvedConfig(root);
    expect(after.autopilot.dryRun).toBe(before.autopilot.dryRun);
    expect(after.distribution.liveGoArmed).toBe(before.distribution.liveGoArmed);
    expect(after.distribution.platforms.x.liveGoArmed).toBe(before.distribution.platforms.x.liveGoArmed);
    expect(after.distribution.platforms.instagram.liveGoArmed).toBe(before.distribution.platforms.instagram.liveGoArmed);
    expect(after.distribution.platforms.tiktok.liveGoArmed).toBe(before.distribution.platforms.tiktok.liveGoArmed);
  });
});
