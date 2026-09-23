import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectObservations, readObservationsReport } from "../src/services/xObservationCollector";

function root(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-x-reaction-"));
}

describe("X observation reaction seed", () => {
  it("records when Bird search is collecting reactions for a news item", async () => {
    const workspaceRoot = root();
    const now = new Date("2026-06-29T10:00:00.000Z");

    await collectObservations(workspaceRoot, {
      now,
      query: "LUUP OR 事故 OR 渋谷",
      reactionSeed: {
        title: "LUUP事故で街の安全感覚が揺れている",
        url: "https://example.com/news/luup",
        source: "example.com"
      },
      runner: async () => ({
        stdout: "@citywatch 2026-06-29T09:00:00.000Z https://x.com/citywatch/status/123 便利って言葉で危なさまで薄めるの、もう限界だと思う"
      })
    });

    const report = await readObservationsReport(workspaceRoot, now);
    expect(report.reactionSeed).toEqual({
      title: "LUUP事故で街の安全感覚が揺れている",
      url: "https://example.com/news/luup",
      source: "example.com"
    });
    expect(report.entries[0]).toMatchObject({
      author: "citywatch",
      url: "https://x.com/citywatch/status/123"
    });
  });
});
