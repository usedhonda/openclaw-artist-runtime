import { describe, expect, it } from "vitest";
import { formatObservationsReport } from "../src/services/telegramCommandRouter";
import type { ObservationReport } from "../src/services/xObservationCollector";

function diagnosticsReport(overrides: Partial<ObservationReport> = {}): ObservationReport {
  return {
    date: "2026-04-29",
    path: "/workspace/observations/2026-04-29.md",
    exists: true,
    query: "\"LUUP 事故\"",
    entries: [],
    diagnostics: {
      date: "2026-04-29",
      collectedAt: "2026-04-29T02:00:00.000Z",
      attempts: [
        {
          query: "\"LUUP 事故\"",
          rawCount: 1,
          acceptedCount: 0,
          rejectedCountsByReason: { short_url_only: 1 },
          firstRejectionSample: {
            reason: "short_url_only",
            hasAuthor: false,
            urlKind: "short",
            hasPostedAt: false
          }
        },
        {
          query: "\"LUUP 事故\" lang:ja since:2026-04-22",
          rawCount: 0,
          acceptedCount: 0,
          rejectedCountsByReason: {}
        }
      ],
      emptyCache: {
        active: true,
        ttlMinutes: 20,
        until: "2026-04-29T02:20:00.000Z"
      }
    },
    ...overrides
  };
}

describe("Telegram observations report diagnostics", () => {
  it("shows search attempts even when no observations were accepted", () => {
    const text = formatObservationsReport(diagnosticsReport());

    expect(text).toContain("🔎 探し方");
    expect(text).toContain("1. \"LUUP 事故\" — raw 1 → accepted 0");
    expect(text).toContain("reject: short_url_only x1");
    expect(text).toContain("0件理由: 全候補が reject");
    expect(text).toContain("空キャッシュ: 20分中");
  });

  it("shows diagnostics with accepted observations without leaking rejected content", () => {
    const text = formatObservationsReport(diagnosticsReport({
      entries: [
        {
          text: "便利の顔で危険を薄める街",
          author: "citywatch",
          url: "https://x.com/citywatch/status/2222222222222222222",
          postedAt: "2026-04-29T01:30:00.000Z"
        }
      ],
      diagnostics: {
        date: "2026-04-29",
        collectedAt: "2026-04-29T02:00:00.000Z",
        attempts: [
          {
            query: "\"narrow\"",
            rawCount: 1,
            acceptedCount: 0,
            rejectedCountsByReason: { short_url_only: 1 },
            firstRejectionSample: {
              reason: "short_url_only",
              hasAuthor: false,
              urlKind: "short",
              hasPostedAt: false
            }
          },
          {
            query: "\"broad\"",
            rawCount: 1,
            acceptedCount: 1,
            rejectedCountsByReason: {}
          }
        ],
        emptyCache: {
          active: false,
          ttlMinutes: 20
        }
      }
    }));

    expect(text).toContain("Total: 1 entries");
    expect(text).toContain("2. \"broad\" — raw 1 → accepted 1");
    expect(text).toContain("summary: raw 2 → accepted 1");
    expect(text).not.toContain("private rejected body");
    expect(text).not.toContain("https://t.co/secret");
  });
});
