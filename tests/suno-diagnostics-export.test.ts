import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSongState, updateSongState } from "../src/services/artistState.js";
import { createInProcessGateway } from "./harness/inProcessGateway.js";

async function seedDiagnosticsWorkspace(root: string): Promise<void> {
  const now = Date.now();
  const daysAgo = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
  const recentResetAt = daysAgo(2);
  const oldResetAt = daysAgo(20);
  const recentImportAt = daysAgo(2);
  const oldImportAt = daysAgo(20);

  await mkdir(join(root, "runtime", "suno"), { recursive: true });
  await writeFile(
    join(root, "runtime", "suno", "budget-reset.jsonl"),
    [
      JSON.stringify({ timestamp: recentResetAt, consumedBefore: 30, reason: "recent_reset" }),
      JSON.stringify({ timestamp: oldResetAt, consumedBefore: 50, reason: "old_reset" })
    ].join("\n") + "\n",
    "utf8"
  );
  await writeFile(
    join(root, "runtime", "suno-worker.json"),
    `${JSON.stringify({
      state: "connected",
      connected: true,
      sunoProfileStale: true,
      sunoProfileDetail: "profile latest activity is stale",
      sunoProfileCheckedAt: "2026-04-25T00:00:00.000Z"
    })}\n`,
    "utf8"
  );
  await ensureSongState(root, "song-recent", "Recent Import");
  await updateSongState(root, "song-recent", {
    lastImportOutcome: {
      runId: "run-recent",
      urlCount: 1,
      pathCount: 1,
      paths: [join(root, "runtime", "suno", "run-recent", "track.mp3")],
      failedUrls: [],
      reason: "imported",
      at: recentImportAt,
      dryRun: false
    }
  });
  await ensureSongState(root, "song-old", "Old Import");
  await updateSongState(root, "song-old", {
    lastImportOutcome: {
      runId: "run-old",
      urlCount: 1,
      pathCount: 0,
      paths: [],
      failedUrls: [{ url: "https://suno.com/song/old", reason: "404" }],
      reason: "old",
      at: oldImportAt,
      dryRun: false
    }
  });
}

describe("Suno diagnostics export route", () => {
  it("exports seven-day profile, reset history, and import outcomes without credential fields", async () => {
    const gateway = await createInProcessGateway();
    try {
      await seedDiagnosticsWorkspace(gateway.workspaceRoot);

      const response = await gateway.request<{
        days: number;
        profile: { state: string; connected: boolean; stale?: boolean; detail?: string };
        budgetResetHistory: Array<{ reason: string }>;
        importOutcomes: Array<{ songId: string; runId: string }>;
      }>("GET", "/plugins/artist-runtime/api/suno/diagnostics/export?days=7");
      const serialized = JSON.stringify(response.body).toLowerCase();

      expect(response.body.days).toBe(7);
      expect(response.body.profile).toMatchObject({
        state: "connected",
        connected: true,
        stale: true
      });
      expect(response.body.budgetResetHistory.map((entry) => entry.reason)).toEqual(["recent_reset"]);
      expect(response.body.importOutcomes.map((outcome) => outcome.runId)).toEqual(["run-recent"]);
      expect(serialized).not.toContain("cookie");
      expect(serialized).not.toContain("token");
    } finally {
      await gateway.teardown();
    }
  });

  it("includes older entries when the window is 30 days", async () => {
    const gateway = await createInProcessGateway();
    try {
      await seedDiagnosticsWorkspace(gateway.workspaceRoot);

      const response = await gateway.request<{
        budgetResetHistory: Array<{ reason: string }>;
        importOutcomes: Array<{ runId: string }>;
      }>("GET", "/plugins/artist-runtime/api/suno/diagnostics/export?days=30");

      expect(response.body.budgetResetHistory.map((entry) => entry.reason)).toEqual(["recent_reset", "old_reset"]);
      expect(response.body.importOutcomes.map((outcome) => outcome.runId)).toEqual(["run-recent", "run-old"]);
    } finally {
      await gateway.teardown();
    }
  });

  it("clamps over-large day windows to 30 days", async () => {
    const gateway = await createInProcessGateway();
    try {
      await seedDiagnosticsWorkspace(gateway.workspaceRoot);

      const response = await gateway.request<{ days: number; importOutcomes: Array<{ runId: string }> }>(
        "GET",
        "/plugins/artist-runtime/api/suno/diagnostics/export?days=365"
      );

      expect(response.body.days).toBe(30);
      expect(response.body.importOutcomes.map((outcome) => outcome.runId)).toEqual(["run-recent", "run-old"]);
    } finally {
      await gateway.teardown();
    }
  });
});
