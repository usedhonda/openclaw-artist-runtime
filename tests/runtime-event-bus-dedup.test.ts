import { describe, expect, it } from "vitest";
import { RuntimeEventBus } from "../src/services/runtimeEventBus";

describe("RuntimeEventBus.emitWithDedup", () => {
  it("emits the first event and skips duplicates within the dedup window", () => {
    const bus = new RuntimeEventBus();
    const events: string[] = [];
    bus.subscribe((event) => events.push(event.type));

    const first = bus.emitWithDedup({
      event: { type: "error", source: "test", reason: "one", timestamp: 1 },
      dedupKey: "error:test:one",
      dedupMs: 5000,
      now: 1000
    });
    const second = bus.emitWithDedup({
      event: { type: "error", source: "test", reason: "one", timestamp: 2 },
      dedupKey: "error:test:one",
      dedupMs: 5000,
      now: 2000
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(events).toEqual(["error"]);
  });

  it("emits again once the dedup window has elapsed", () => {
    const bus = new RuntimeEventBus();
    const events: string[] = [];
    bus.subscribe((event) => events.push(event.type));

    bus.emitWithDedup({
      event: { type: "error", source: "test", reason: "one", timestamp: 1 },
      dedupKey: "error:test:one",
      dedupMs: 5000,
      now: 0
    });
    const after = bus.emitWithDedup({
      event: { type: "error", source: "test", reason: "one", timestamp: 2 },
      dedupKey: "error:test:one",
      dedupMs: 5000,
      now: 6000
    });

    expect(after).toBe(true);
    expect(events).toEqual(["error", "error"]);
  });

  it("treats different dedup keys independently", () => {
    const bus = new RuntimeEventBus();
    const events: string[] = [];
    bus.subscribe((event) => events.push(event.type));

    const a = bus.emitWithDedup({
      event: { type: "error", source: "alpha", reason: "x", timestamp: 1 },
      dedupKey: "alpha",
      dedupMs: 5000,
      now: 0
    });
    const b = bus.emitWithDedup({
      event: { type: "error", source: "beta", reason: "y", timestamp: 1 },
      dedupKey: "beta",
      dedupMs: 5000,
      now: 0
    });

    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(events).toEqual(["error", "error"]);
  });
});
