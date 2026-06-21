import { appendFile, mkdir } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_USED_HONDA_DURATION_PLAN } from "../src/suno-production/durationPlan";
import { buildSunoStatusResponse } from "../src/routes";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { createSongIdea } from "../src/services/songIdeation";
import { importSunoResults, readAllSunoRuns } from "../src/services/sunoRuns";
import type { SunoLyricsSubmitTelemetry, SunoRunRecord } from "../src/types";

describe("Suno submit telemetry ledger", () => {
  it("carries lyrics submit telemetry into imported runs and records generated duration for status export", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-submit-telemetry-"));
    await ensureArtistWorkspace(root);
    const song = await createSongIdea({
      workspaceRoot: root,
      title: "Telemetry Road",
      artistReason: "measure the box"
    });
    const runId = "run-telemetry";
    const telemetry: SunoLyricsSubmitTelemetry = {
      bareLyricsChars: 1840,
      markerChars: 620,
      submittedPayloadChars: 2460,
      effectiveLyricsBoxLimit: 5000,
      textareaMaxLength: 5000,
      textareaReadbackChars: 2460,
      readbackMatches: true
    };
    const acceptedRun: SunoRunRecord = {
      runId,
      songId: song.songId,
      createdAt: "2026-06-21T00:00:00.000Z",
      mode: "background_browser_worker",
      authorityDecision: {
        allowed: true,
        reason: "submitted",
        policyDecision: "auto_create_and_select_take"
      },
      payloadHash: "payload-hash",
      status: "accepted",
      dryRun: false,
      urls: ["https://suno.com/song/telemetry-road"],
      lyricsTelemetry: telemetry
    };
    const runsPath = join(root, "songs", song.songId, "suno", "runs.jsonl");
    await mkdir(join(root, "songs", song.songId, "suno"), { recursive: true });
    await appendFile(runsPath, `${JSON.stringify(acceptedRun)}\n`, "utf8");

    const imported = await importSunoResults({
      workspaceRoot: root,
      songId: song.songId,
      runId,
      urls: ["https://suno.com/song/telemetry-road"],
      resultRefs: [join(root, "runtime", "suno", runId, "telemetry-road.mp3")],
      metadata: [
        {
          url: "https://suno.com/song/telemetry-road",
          path: join(root, "runtime", "suno", runId, "telemetry-road.mp3"),
          format: "mp3",
          title: "Telemetry Road",
          durationSec: 207
        }
      ],
      config: {
        autopilot: { dryRun: false }
      }
    });

    expect(imported.lyricsTelemetry).toEqual(telemetry);
    expect(imported.generatedDurationSec).toBe(207);
    expect(imported.durationDeltaSec).toBe(207 - DEFAULT_USED_HONDA_DURATION_PLAN.targetSeconds);

    const runs = await readAllSunoRuns(root, song.songId);
    expect(runs.find((run) => run.status === "imported")).toMatchObject({
      runId,
      status: "imported",
      lyricsTelemetry: telemetry,
      generatedDurationSec: 207,
      durationDeltaSec: 207 - DEFAULT_USED_HONDA_DURATION_PLAN.targetSeconds
    });

    const status = await buildSunoStatusResponse({
      artist: { workspaceRoot: root }
    });
    expect(status.recentRuns.find((run) => run.status === "imported")).toMatchObject({
      runId,
      lyricsTelemetry: telemetry,
      generatedDurationSec: 207,
      durationDeltaSec: 207 - DEFAULT_USED_HONDA_DURATION_PLAN.targetSeconds
    });
  });
});
