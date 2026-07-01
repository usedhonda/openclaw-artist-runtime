import React from "../ui/node_modules/react/index.js";
import { renderToStaticMarkup } from "../ui/node_modules/react-dom/server.node.js";
import { describe, expect, it } from "vitest";
import { BirdCallLedgerCard } from "../ui/src/components/BirdCallLedgerCard";
import { DistributionDetectionCard } from "../ui/src/components/DistributionDetectionCard";

describe("producer console music/platform detail cards", () => {
  it("renders Bird calls and cooldown state", () => {
    const html = renderToStaticMarkup(
      React.createElement(BirdCallLedgerCard, {
        ledger: {
          todayCalls: [{ timestamp: "2026-04-29T02:00:00.000Z", query: "rail noise", mode: "topical" }],
          cooldown: { until: "2026-04-30T02:10:00.000Z", reason: "rate limit smoke" },
          nextAllowedAt: "2026-04-29T03:00:00.000Z"
        }
      })
    );

    expect(html).toContain("Bird Call Ledger");
    expect(html).toContain("Cooling down until");
    expect(html).toContain("rate limit smoke");
    expect(html).toContain("rail noise");
    expect(html).toContain("topical");
  });

  it("renders distribution detection details", () => {
    const html = renderToStaticMarkup(
      React.createElement(DistributionDetectionCard, {
        detected: {
          unitedMasters: { lastCheckedAt: "2026-04-29T03:00:00.000Z" },
          spotify: { url: "https://open.spotify.com/test", detectedAt: "2026-04-29T03:05:00.000Z", lastCheckedAt: "2026-04-29T03:10:00.000Z" },
          appleMusic: { lastCheckedAt: "2026-04-29T03:00:00.000Z" }
        }
      })
    );

    expect(html).toContain("Distribution Detection");
    expect(html).toContain("UnitedMasters");
    expect(html).toContain("Spotify");
    expect(html).toContain("detected");
    expect(html).toContain("https://open.spotify.com/test");
    expect(html).toContain("last checked");
  });
});
