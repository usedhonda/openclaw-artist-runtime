import { describe, expect, it } from "vitest";
import { classifyDistributionDecision, filterDistributionEvents, type DistributionEventsFilterState } from "../src/services/distributionEventsFilter";
import type { DistributionEvent } from "../src/types";

function event(overrides: Partial<DistributionEvent>): DistributionEvent {
  return {
    timestamp: "2026-04-25T00:00:00.000Z",
    platform: "x",
    connector: "bird",
    songId: "song-001",
    postType: "status",
    action: "publish",
    accepted: false,
    dryRun: true,
    mediaRefs: [],
    reason: "dry-run blocks publish",
    ...overrides
  };
}

const baseFilter: DistributionEventsFilterState = {
  platform: "all",
  decision: "all",
  search: ""
};

describe("distribution events filter", () => {
  it("classifies accepted, dry-run, and blocked event decisions", () => {
    expect(classifyDistributionDecision(event({ accepted: true, dryRun: false }))).toBe("published");
    expect(classifyDistributionDecision(event({ accepted: false, dryRun: true }))).toBe("dryRun");
    expect(classifyDistributionDecision(event({ accepted: false, dryRun: false }))).toBe("blocked");
  });

  it("filters by platform and decision", () => {
    const events = [
      event({ platform: "x", accepted: true, dryRun: false, reason: "ok" }),
      event({ platform: "instagram", accepted: false, dryRun: true, reason: "dry" }),
      event({ platform: "x", accepted: false, dryRun: false, reason: "blocked" })
    ];

    expect(filterDistributionEvents(events, { ...baseFilter, platform: "x", decision: "blocked" })).toEqual([events[2]]);
  });

  it("filters by inclusive UTC date strings", () => {
    const events = [
      event({ timestamp: "2026-04-20T00:00:00.000Z" }),
      event({ timestamp: "2026-04-25T12:00:00.000Z" }),
      event({ timestamp: "2026-04-26T00:00:00.000Z" })
    ];

    expect(filterDistributionEvents(events, { ...baseFilter, from: "2026-04-25", to: "2026-04-25" })).toEqual([events[1]]);
  });

  it("searches reason, URL, song id, and reply target metadata", () => {
    const events = [
      event({ reason: "bird_auth_expired", url: "https://x.com/artist/status/1" }),
      event({
        songId: "song-needle",
        reason: "dry",
        replyTarget: {
          type: "reply",
          targetId: "1900000000000000000",
          resolvedFrom: "https://x.com/source/status/1900000000000000000",
          dryRun: true,
          timestamp: "2026-04-25T00:00:00.000Z"
        }
      })
    ];

    expect(filterDistributionEvents(events, { ...baseFilter, search: "needle" })).toEqual([events[1]]);
    expect(filterDistributionEvents(events, { ...baseFilter, search: "auth expired" })).toEqual([]);
    expect(filterDistributionEvents(events, { ...baseFilter, search: "bird_auth" })).toEqual([events[0]]);
  });
});
