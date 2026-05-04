import { describe, expect, it, vi } from "vitest";
import {
  InMemoryPresenceCooldown,
  startArtistPresenceLayer,
  type PresenceMessage
} from "../src/services/artistPresenceLayer";
import { RuntimeEventBus } from "../src/services/runtimeEventBus";
import type { PersonaMotifBundle } from "../src/services/personaMotifExtractor";

interface FakeScheduler {
  schedule: (cb: () => void, ms: number) => number;
  cancel: (handle: unknown) => void;
  advance: (ms: number) => Promise<void>;
}

function fakeScheduler(): FakeScheduler {
  const tasks = new Map<number, { runAt: number; cb: () => void }>();
  let nextHandle = 1;
  let now = 0;
  return {
    schedule(cb, ms) {
      const handle = nextHandle++;
      tasks.set(handle, { runAt: now + ms, cb });
      return handle;
    },
    cancel(handle: unknown) {
      tasks.delete(handle as number);
    },
    async advance(ms: number) {
      now += ms;
      const due = [...tasks.entries()].filter(([, task]) => task.runAt <= now);
      for (const [handle, task] of due) {
        tasks.delete(handle);
        task.cb();
      }
      await Promise.resolve();
    }
  };
}

const motifs: PersonaMotifBundle = {
  themes: ["社会風刺", "再開発"],
  vocabulary: ["経営者"],
  geographies: ["渋谷", "六本木"],
  sound: ["nu-jazz rap"],
  avoid: [],
  raw: ""
};

describe("artist presence layer", () => {
  it("schedules a producer_silent_after_take ping after a take, then enforces 24h cooldown", async () => {
    const bus = new RuntimeEventBus();
    const scheduler = fakeScheduler();
    const notify = vi.fn(async (_message: PresenceMessage) => {});
    let fakeNow = 1_000;
    const handle = startArtistPresenceLayer({
      bus,
      notify,
      cooldown: new InMemoryPresenceCooldown(),
      silentAfterTakeMs: 60_000,
      now: () => fakeNow,
      scheduler: scheduler.schedule,
      cancelScheduled: scheduler.cancel,
      loadMotifs: async () => motifs
    });

    bus.emit({ type: "song_take_completed", songId: "song-007", urls: [], timestamp: fakeNow });
    expect(notify).not.toHaveBeenCalled();
    fakeNow += 60_000;
    await scheduler.advance(60_000);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({
      trigger: "producer_silent_after_take",
      songId: "song-007"
    });

    // second take within cooldown window — schedule fires but cooldown blocks
    bus.emit({ type: "song_take_completed", songId: "song-008", urls: [], timestamp: fakeNow });
    fakeNow += 60_000;
    await scheduler.advance(60_000);
    expect(notify).toHaveBeenCalledTimes(1);

    handle.stop();
  });

  it("emits observation_high_score presence only when score is above threshold", async () => {
    const bus = new RuntimeEventBus();
    const scheduler = fakeScheduler();
    const notify = vi.fn(async () => {});
    let fakeNow = 5_000;
    const handle = startArtistPresenceLayer({
      bus,
      notify,
      observationScoreThreshold: 7,
      now: () => fakeNow,
      scheduler: scheduler.schedule,
      cancelScheduled: scheduler.cancel,
      loadMotifs: async () => motifs
    });

    bus.emit({ type: "observation_collected", entryCount: 5, topScore: 4, timestamp: fakeNow });
    await Promise.resolve();
    expect(notify).not.toHaveBeenCalled();

    bus.emit({
      type: "observation_collected",
      entryCount: 5,
      topScore: 9,
      topMotifMatch: "geographies: 渋谷 | themes: 再開発",
      timestamp: fakeNow
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(notify).toHaveBeenCalledTimes(1);
    const call = notify.mock.calls[0][0];
    expect(call.trigger).toBe("observation_high_score");
    expect(call.text.length).toBeGreaterThan(0);

    handle.stop();
  });

  it("skips notify when producer is currently typing", async () => {
    const bus = new RuntimeEventBus();
    const scheduler = fakeScheduler();
    const notify = vi.fn(async () => {});
    const handle = startArtistPresenceLayer({
      bus,
      notify,
      observationScoreThreshold: 1,
      now: () => 100,
      scheduler: scheduler.schedule,
      cancelScheduled: scheduler.cancel,
      isProducerTyping: () => true,
      loadMotifs: async () => motifs
    });

    bus.emit({ type: "observation_collected", entryCount: 3, topScore: 9, timestamp: 100 });
    await Promise.resolve();
    await Promise.resolve();
    expect(notify).not.toHaveBeenCalled();

    handle.stop();
  });

  it("uses a custom composer and a generic 'how are you' is never produced", async () => {
    const bus = new RuntimeEventBus();
    const scheduler = fakeScheduler();
    const notify = vi.fn(async () => {});
    const handle = startArtistPresenceLayer({
      bus,
      notify,
      observationScoreThreshold: 0,
      now: () => 10,
      scheduler: scheduler.schedule,
      cancelScheduled: scheduler.cancel,
      loadMotifs: async () => motifs,
      compose: (input) => `[${input.trigger}] ${input.motifs?.themes[0] ?? "void"}`
    });

    bus.emit({ type: "observation_collected", entryCount: 1, topScore: 10, timestamp: 10 });
    await Promise.resolve();
    await Promise.resolve();
    expect(notify).toHaveBeenCalledTimes(1);
    const text = notify.mock.calls[0][0].text;
    expect(text).toContain("[observation_high_score]");
    expect(text).not.toContain("最近どう");
    expect(text).not.toContain("元気");

    handle.stop();
  });

  it("the default composer never returns generic 'how are you' phrasing", () => {
    const composed = [
      { trigger: "observation_high_score" as const, motifs },
      { trigger: "producer_silent_after_take" as const, motifs }
    ].map((input) => {
      const bus = new RuntimeEventBus();
      const result: string[] = [];
      const scheduler = fakeScheduler();
      const handle = startArtistPresenceLayer({
        bus,
        notify: (message) => {
          result.push(message.text);
        },
        observationScoreThreshold: 0,
        now: () => 1,
        scheduler: scheduler.schedule,
        cancelScheduled: scheduler.cancel,
        loadMotifs: async () => motifs
      });
      if (input.trigger === "observation_high_score") {
        bus.emit({
          type: "observation_collected",
          entryCount: 1,
          topScore: 10,
          topMotifMatch: "themes: 再開発",
          timestamp: 1
        });
      } else {
        bus.emit({ type: "song_take_completed", songId: "song-1", urls: [], timestamp: 1 });
        void scheduler.advance(60 * 60 * 1000);
      }
      handle.stop();
      return result;
    });
    for (const result of composed) {
      for (const text of result) {
        expect(text).not.toMatch(/最近どう|元気|how are you/i);
      }
    }
  });
});
