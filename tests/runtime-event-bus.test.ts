import { describe, expect, it } from "vitest";
import { RuntimeEventBus } from "../src/services/runtimeEventBus";

describe("RuntimeEventBus", () => {
  it("subscribes, emits, and unsubscribes handlers", () => {
    const bus = new RuntimeEventBus();
    const events: string[] = [];
    const unsubscribe = bus.subscribe((event) => events.push(event.type));

    bus.emit({ type: "autopilot_state_changed", enabled: true, paused: false, timestamp: 1 });
    unsubscribe();
    bus.emit({ type: "error", source: "test", reason: "after_unsubscribe", timestamp: 2 });

    expect(events).toEqual(["autopilot_state_changed"]);
  });

  it("keeps recent events in newest-first order", () => {
    const bus = new RuntimeEventBus();

    bus.emit({ type: "error", source: "first", reason: "one", timestamp: 1 });
    bus.emit({ type: "error", source: "second", reason: "two", timestamp: 2 });

    expect(bus.listRecent(2).map((event) => event.type === "error" ? event.source : "")).toEqual(["second", "first"]);
  });
});
