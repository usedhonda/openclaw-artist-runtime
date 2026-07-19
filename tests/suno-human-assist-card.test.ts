import React from "../ui/node_modules/react/index.js";
import { renderToStaticMarkup } from "../ui/node_modules/react-dom/server.node.js";
import { describe, expect, it } from "vitest";
import {
  SunoHumanAssistCard,
  activeHumanAssistEvents,
  isHumanAssistActive,
  humanAssistRemainingMinutes,
  parseSunoHumanAssistEvent,
  type SunoHumanAssistEvent
} from "../ui/src/components/SunoHumanAssistCard";

const BASE = 1_760_000_000_000;

function event(overrides: Partial<SunoHumanAssistEvent> = {}): SunoHumanAssistEvent {
  return {
    type: "suno_human_assist_requested",
    songId: "song-1",
    title: "Neon Alley",
    timeoutMinutes: 60,
    timestamp: BASE,
    ...overrides
  };
}

describe("SunoHumanAssistCard helpers", () => {
  it("parses only well-formed human-assist events", () => {
    const ok = JSON.stringify(event());
    expect(parseSunoHumanAssistEvent(ok)?.songId).toBe("song-1");
    expect(parseSunoHumanAssistEvent(JSON.stringify({ type: "other" }))).toBeUndefined();
    expect(parseSunoHumanAssistEvent("not json")).toBeUndefined();
  });

  it("treats a request as active until its timeout window elapses", () => {
    expect(isHumanAssistActive(event(), BASE + 30 * 60_000)).toBe(true);
    expect(isHumanAssistActive(event(), BASE + 60 * 60_000)).toBe(false);
    expect(isHumanAssistActive(event(), BASE + 61 * 60_000)).toBe(false);
  });

  it("reports remaining minutes and drops expired events", () => {
    expect(humanAssistRemainingMinutes(event(), BASE + 30 * 60_000)).toBe(30);
    expect(humanAssistRemainingMinutes(event(), BASE + 90 * 60_000)).toBe(0);
    const active = activeHumanAssistEvents([event(), event({ songId: "song-2", timestamp: BASE - 120 * 60_000 })], BASE + 5 * 60_000);
    expect(active.map((entry) => entry.songId)).toEqual(["song-1"]);
  });

  it("keeps the latest request per song", () => {
    const older = event({ timestamp: BASE });
    const newer = event({ timestamp: BASE + 60_000, title: "Neon Alley v2" });
    const active = activeHumanAssistEvents([older, newer], BASE + 2 * 60_000);
    expect(active).toHaveLength(1);
    expect(active[0].title).toBe("Neon Alley v2");
  });
});

describe("SunoHumanAssistCard render", () => {
  it("shows the create-click banner for an active request", () => {
    const html = renderToStaticMarkup(
      React.createElement(SunoHumanAssistCard, { locale: "en", now: BASE + 10 * 60_000, events: [event()] })
    );
    expect(html).toContain("Suno needs your Create click");
    expect(html).toContain("Neon Alley");
    expect(html).toContain("50 min left");
  });

  it("renders nothing once the request has expired", () => {
    const html = renderToStaticMarkup(
      React.createElement(SunoHumanAssistCard, { locale: "en", now: BASE + 120 * 60_000, events: [event()] })
    );
    expect(html).toBe("");
  });
});
