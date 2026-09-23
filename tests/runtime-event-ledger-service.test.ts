import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startRuntimeEventLedgerFromEnv, stopRuntimeEventLedgerSubscription } from "../src/services";
import { getRuntimeEventBus } from "../src/services/runtimeEventBus";
import { readSongEventsAsc } from "../src/services/runtimeEventsLedger";

describe("runtime event ledger service", () => {
  afterEach(() => {
    stopRuntimeEventLedgerSubscription();
    getRuntimeEventBus().clearForTest();
  });

  it("persists runtime bus events for song lifecycle surfaces", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-event-ledger-service-"));

    expect(startRuntimeEventLedgerFromEnv({ OPENCLAW_LOCAL_WORKSPACE: root } as NodeJS.ProcessEnv)).toEqual({ started: 1 });
    expect(startRuntimeEventLedgerFromEnv({ OPENCLAW_LOCAL_WORKSPACE: root } as NodeJS.ProcessEnv)).toEqual({
      started: 0,
      reason: "already_started"
    });

    getRuntimeEventBus().emit({
      type: "song_take_completed",
      songId: "song-ledger",
      selectedTakeId: "take-1",
      urls: ["https://suno.example/take-1"],
      timestamp: 1778800000000
    });

    await vi.waitFor(async () => {
      const events = await readSongEventsAsc(root, "song-ledger");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "song_take_completed",
        songId: "song-ledger",
        selectedTakeId: "take-1"
      });
    });
  });
});
