import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildStatusResponse, buildSunoStatusResponse } from "../src/routes";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { createAndPersistSunoPromptPack } from "../src/services/sunoPromptPackFiles";
import { SunoBrowserWorker, type SunoBrowserDriver } from "../src/services/sunoBrowserWorker";
import { generateSunoRun, importSunoResults } from "../src/services/sunoRuns";
import { buildImportedAssetRows, importedAssetsPlaceholder } from "../src/services/sunoImportedAssetsView";

async function prepareImportedAssetWorkspace(urls: string[]) {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-imported-assets-"));
  await ensureArtistWorkspace(root);
  await createAndPersistSunoPromptPack({
    workspaceRoot: root,
    songId: "song-001",
    songTitle: "Ghost Station",
    artistReason: "relay dust",
    lyricsText: "station glass under static",
    knowledgePackVersion: "test-pack"
  });

  const generated = await generateSunoRun({
    workspaceRoot: root,
    songId: "song-001"
  });
  await importSunoResults({
    workspaceRoot: root,
    songId: "song-001",
    runId: generated.runId,
    urls
  });

  return {
    root,
    runId: generated.runId,
    urls
  };
}

describe("suno imported asset status surface", () => {
  it("surfaces two imported mp3 assets through /api/status and /api/suno/status", async () => {
    const prepared = await prepareImportedAssetWorkspace([
      "https://suno.com/song/track-1",
      "https://suno.com/song/track-2"
    ]);
    const worker = new SunoBrowserWorker(prepared.root);
    await worker.setState("connected");

    const driver: SunoBrowserDriver = {
      probe: async () => ({ state: "connected" }),
      importResults: async () => ({
        accepted: true,
        runId: prepared.runId,
        urls: prepared.urls,
        paths: [
          `${prepared.root}/runtime/suno/${prepared.runId}/track-1.mp3`,
          `${prepared.root}/runtime/suno/${prepared.runId}/track-2.mp3`
        ],
        metadata: [
          {
            url: prepared.urls[0]!,
            path: `${prepared.root}/runtime/suno/${prepared.runId}/track-1.mp3`,
            format: "mp3",
            title: "Track One",
            durationSec: 121
          },
          {
            url: prepared.urls[1]!,
            path: `${prepared.root}/runtime/suno/${prepared.runId}/track-2.mp3`,
            format: "mp3",
            title: "Track Two",
            durationSec: 138
          }
        ],
        importedAt: "2026-04-22T00:00:00.000Z",
        reason: "imported"
      })
    };

    await worker.importRun(prepared.runId, prepared.urls, { driver });

    const status = await buildStatusResponse({ artist: { workspaceRoot: prepared.root } });
    const sunoStatus = await buildSunoStatusResponse({ artist: { workspaceRoot: prepared.root } });

    expect(status.recentSong?.songId).toBe("song-001");
    expect(status.recentSong?.lastImportOutcome).toMatchObject({
      runId: prepared.runId,
      urlCount: 2,
      failedUrls: []
    });
    expect(status.lastSunoRun?.runId).toBe(prepared.runId);
    expect(status.sunoWorker.lastImportOutcome).toMatchObject({
      runId: prepared.runId,
      pathCount: 2
    });
    expect(status.sunoWorker.lastImportOutcome?.paths).toHaveLength(2);
    expect(status.sunoWorker.lastImportOutcome?.metadata).toHaveLength(2);
    expect(sunoStatus.lastImportOutcome?.metadata?.map((asset) => asset.format)).toEqual(["mp3", "mp3"]);
    expect(buildImportedAssetRows(sunoStatus.lastImportOutcome)).toHaveLength(2);
    expect(importedAssetsPlaceholder(sunoStatus.lastImportOutcome)).toBeNull();
  });

  it("prefers direct recovery import truth over a stale worker failure for the same run", async () => {
    const prepared = await prepareImportedAssetWorkspace([
      "https://suno.com/song/recovered-track"
    ]);

    let sunoStatus = await buildSunoStatusResponse({ artist: { workspaceRoot: prepared.root } });
    expect(sunoStatus.worker.lastImportOutcome).toMatchObject({
      runId: prepared.runId,
      reason: "Suno results imported",
      failedUrls: []
    });

    const worker = new SunoBrowserWorker(prepared.root);
    await worker.setState("connected");
    await worker.importRun(prepared.runId, prepared.urls, {
      driver: {
        probe: async () => ({ state: "connected" }),
        importResults: async () => ({
          accepted: false,
          runId: prepared.runId,
          urls: [],
          paths: [],
          metadata: [],
          importedAt: "2026-04-22T00:01:00.000Z",
          reason: "playwright_import_no_urls"
        })
      }
    });

    const status = await buildStatusResponse({ artist: { workspaceRoot: prepared.root } });
    sunoStatus = await buildSunoStatusResponse({ artist: { workspaceRoot: prepared.root } });

    expect(status.recentSong?.lastImportOutcome).toMatchObject({
      runId: prepared.runId,
      reason: "Suno results imported"
    });
    expect(status.sunoWorker.lastImportOutcome).toMatchObject({
      runId: prepared.runId,
      reason: "Suno results imported",
      failedUrls: []
    });
    expect(sunoStatus.lastImportOutcome).toMatchObject({
      runId: prepared.runId,
      reason: "Suno results imported",
      failedUrls: []
    });
  });

  it("keeps imported asset UI on placeholder when no paths are available", async () => {
    const prepared = await prepareImportedAssetWorkspace([]);
    const worker = new SunoBrowserWorker(prepared.root);
    await worker.setState("connected");

    await worker.importRun(prepared.runId, [], {
      driver: {
        probe: async () => ({ state: "connected" }),
        importResults: async () => ({
          accepted: false,
          runId: prepared.runId,
          urls: [],
          paths: [],
          metadata: [],
          importedAt: "2026-04-22T00:00:00.000Z",
          reason: "playwright_import_no_urls"
        })
      }
    });

    const sunoStatus = await buildSunoStatusResponse({ artist: { workspaceRoot: prepared.root } });

    expect(sunoStatus.lastImportOutcome?.paths).toEqual([]);
    expect(sunoStatus.lastImportOutcome?.metadata).toEqual([]);
    expect(buildImportedAssetRows(sunoStatus.lastImportOutcome)).toEqual([]);
    expect(importedAssetsPlaceholder(sunoStatus.lastImportOutcome)).toBe("No imported assets yet.");
  });

  it("surfaces m4a imported asset metadata without changing the song URL pattern", async () => {
    const prepared = await prepareImportedAssetWorkspace([
      "https://suno.com/song/fallback-track"
    ]);
    const worker = new SunoBrowserWorker(prepared.root);
    await worker.setState("connected");

    await worker.importRun(prepared.runId, prepared.urls, {
      driver: {
        probe: async () => ({ state: "connected" }),
        importResults: async () => ({
          accepted: true,
          runId: prepared.runId,
          urls: prepared.urls,
          paths: [`${prepared.root}/runtime/suno/${prepared.runId}/fallback-track.m4a`],
          metadata: [
            {
              url: prepared.urls[0]!,
              path: `${prepared.root}/runtime/suno/${prepared.runId}/fallback-track.m4a`,
              format: "m4a",
              title: "Fallback Track",
              durationSec: 95
            }
          ],
          importedAt: "2026-04-22T00:00:00.000Z",
          reason: "imported"
        })
      }
    });

    const status = await buildStatusResponse({ artist: { workspaceRoot: prepared.root } });
    const rows = buildImportedAssetRows(status.sunoWorker.lastImportOutcome);

    expect(status.lastSunoRun?.runId).toBe(prepared.runId);
    expect(status.lastSunoRun?.urls).toEqual(prepared.urls);
    expect(rows).toMatchObject([
      {
        url: "https://suno.com/song/fallback-track",
        format: "m4a",
        title: "Fallback Track"
      }
    ]);
  });
});
