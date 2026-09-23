import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createInProcessGateway } from "../harness/inProcessGateway.js";
import { readDistributionEvents } from "../../src/services/distributionLedgerReader.js";
import { appendSocialPublishLedgerEntry, getSocialLedgerArchivePath } from "../../src/services/socialPublishLedger.js";
import { SunoBrowserWorker, type SunoBrowserDriver } from "../../src/services/sunoBrowserWorker.js";
import { buildSunoArtifactIndex, importSunoResults, readLatestSunoRun } from "../../src/services/sunoRuns.js";
import { readSongState } from "../../src/services/artistState.js";
import type { SocialPublishLedgerEntry } from "../../src/types.js";

function oldSocialEntry(songId: string): SocialPublishLedgerEntry {
  return {
    timestamp: "2025-12-01T00:00:00.000Z",
    platform: "x",
    connector: "bird",
    songId,
    postType: "text",
    action: "publish",
    accepted: false,
    dryRun: true,
    mediaRefs: [],
    reason: "dry-run archive regression",
    verification: {
      status: "pending",
      detail: "dry-run archive regression"
    }
  };
}

describe("Suno mock submit/import/archive chain", () => {
  it("creates with a mock driver, imports artifacts, records ledgers, and reads rotated archive events", async () => {
    const gateway = await createInProcessGateway();

    try {
      const song = await gateway.request<{ songId: string }>("POST", "/plugins/artist-runtime/api/songs/ideate", {
        title: "Suno Chain Smoke",
        artistReason: "mock chain regression"
      });
      const runId = "suno-chain-run";
      const songUrl = "https://suno.com/song/mock-chain-track";
      const assetPath = join(gateway.workspaceRoot, "runtime", "suno", runId, "mock-chain-track.mp3");
      const importedAt = "2026-04-25T00:00:00.000Z";
      const driver: SunoBrowserDriver = {
        async probe() {
          return { state: "connected" };
        },
        async create(request) {
          return {
            accepted: true,
            runId: request.runId ?? runId,
            reason: "submitted_via_mock_driver",
            urls: [songUrl],
            dryRun: request.dryRun
          };
        },
        async importResults(request) {
          await mkdir(dirname(assetPath), { recursive: true });
          await writeFile(assetPath, "mock mp3 bytes", "utf8");
          return {
            accepted: true,
            runId: request.runId,
            urls: request.urls,
            paths: [assetPath],
            metadata: [
              {
                url: songUrl,
                path: assetPath,
                format: "mp3",
                title: "Mock Chain Track",
                durationSec: 12
              }
            ],
            importedAt,
            reason: "imported_via_mock_driver",
            dryRun: false
          };
        }
      };

      const worker = new SunoBrowserWorker(gateway.workspaceRoot);
      const start = await worker.start({ driver });
      expect(start.state).toBe("connected");

      const created = await worker.startCreate({
        dryRun: false,
        authority: "auto_create_and_select_take",
        payload: { prompt: "mock chain payload" },
        songId: song.body.songId,
        runId
      }, { driver, dryRun: false });
      expect(created).toMatchObject({
        accepted: true,
        runId,
        urls: [songUrl]
      });

      const imported = await worker.importRun(runId, created.urls, { driver, dryRun: false });
      expect(imported.paths).toEqual([assetPath]);
      expect(imported.metadata?.[0]?.format).toBe("mp3");

      const persisted = await importSunoResults({
        workspaceRoot: gateway.workspaceRoot,
        songId: song.body.songId,
        runId,
        urls: created.urls,
        resultRefs: imported.paths,
        config: {
          autopilot: { dryRun: false }
        }
      });
      expect(persisted.status).toBe("imported");

      const artifacts = await buildSunoArtifactIndex(gateway.workspaceRoot);
      expect(artifacts).toEqual([
        expect.objectContaining({
          runId,
          songId: song.body.songId,
          path: assetPath,
          format: "mp3"
        })
      ]);

      const latestRun = await readLatestSunoRun(gateway.workspaceRoot, song.body.songId);
      expect(latestRun?.status).toBe("imported");
      expect(latestRun?.urls).toEqual([songUrl]);

      const state = await readSongState(gateway.workspaceRoot, song.body.songId);
      expect(state.lastImportOutcome).toMatchObject({
        runId,
        urlCount: 1,
        pathCount: 1,
        paths: [assetPath]
      });

      const promptLedger = await readFile(join(gateway.workspaceRoot, "songs", song.body.songId, "prompts", "prompt-ledger.jsonl"), "utf8");
      expect(promptLedger).toContain("\"stage\":\"suno_result_import\"");

      await appendSocialPublishLedgerEntry(gateway.workspaceRoot, song.body.songId, oldSocialEntry(song.body.songId), {
        now: new Date("2026-04-25T00:00:00.000Z")
      });
      const archiveContents = await readFile(getSocialLedgerArchivePath(gateway.workspaceRoot, song.body.songId), "utf8");
      expect(archiveContents).toContain("dry-run archive regression");

      const archivedEvents = await readDistributionEvents(gateway.workspaceRoot, 20, { includeArchive: true });
      expect(archivedEvents).toEqual([
        expect.objectContaining({
          songId: song.body.songId,
          platform: "x",
          reason: "dry-run archive regression"
        })
      ]);
    } finally {
      await gateway.teardown();
    }
  }, 30_000);
});
