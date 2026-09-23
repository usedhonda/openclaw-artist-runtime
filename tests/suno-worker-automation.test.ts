import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSunoStatusResponse } from "../src/routes";
import { BrowserWorkerSunoConnector } from "../src/connectors/suno/browserWorkerConnector";
import { SunoBrowserWorker, type SunoBrowserDriver } from "../src/services/sunoBrowserWorker";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn()
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

function createDriver(overrides: Partial<SunoBrowserDriver> = {}): SunoBrowserDriver {
  return {
    async probe() {
      return { state: "connected" };
    },
    async create(request) {
      return {
        accepted: true,
        runId: request.runId ?? "run-driver",
        reason: "mock create accepted",
        urls: []
      };
    },
    async importResults({ runId, urls }) {
      return {
        accepted: urls.length > 0,
        runId,
        urls,
        paths: ["runtime/suno/run-driver/take-1.mp3"],
        importedAt: "2026-04-22T00:00:00.000Z"
      };
    },
    async stop() {
      return;
    },
    ...overrides
  };
}

describe("SunoBrowserWorker automation skeleton", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("returns a dry-run create result without calling the driver", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-create-dry-"));
    const worker = new SunoBrowserWorker(root);
    const driver = createDriver({ create: vi.fn() });

    const result = await worker.startCreate(
      {
        dryRun: true,
        authority: "auto_create_and_select_take",
        payload: { style: "test" },
        songId: "song-001",
        runId: "run-dry"
      },
      { driver, dryRun: true }
    );
    const status = await worker.status();

    expect(result).toMatchObject({
      accepted: false,
      runId: "run-dry",
      reason: "dry-run blocks Suno create",
      dryRun: true
    });
    expect(driver.create).not.toHaveBeenCalled();
    expect(status.state).toBe("connected");
    expect(status.currentRunId).toBe("run-dry");
    expect(spawnMock).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("calls driver.create in real mode and keeps the run in generating state", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-create-real-"));
    const worker = new SunoBrowserWorker(root);
    const driver = createDriver({
      create: vi.fn(async (request) => ({
        accepted: true,
        runId: request.runId ?? "run-real",
        reason: "mock create accepted",
        urls: []
      }))
    });

    await worker.start({ driver });
    const result = await worker.startCreate(
      {
        dryRun: false,
        authority: "auto_create_and_select_take",
        payload: { style: "test" },
        songId: "song-001",
        runId: "run-real"
      },
      { driver }
    );
    const status = await worker.status();

    expect(driver.create).toHaveBeenCalledTimes(1);
    expect(result.accepted).toBe(true);
    expect(status.state).toBe("generating");
    expect(status.currentRunId).toBe("run-real");
    expect(status.pendingAction).toBe("waiting_for_results");
    expect(spawnMock).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns a dry-run import result without calling the driver", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-import-dry-"));
    const worker = new SunoBrowserWorker(root);
    const driver = createDriver({ importResults: vi.fn() });

    const result = await worker.importRun("run-dry-import", ["https://example.com/song-1"], { driver, dryRun: true });
    const status = await worker.status();

    expect(result).toMatchObject({
      runId: "run-dry-import",
      reason: "dry-run blocks Suno import",
      dryRun: true,
      accepted: false
    });
    expect(driver.importResults).not.toHaveBeenCalled();
    expect(status.state).toBe("connected");
    expect(status.lastImportedRunId).toBe("run-dry-import");
    expect(spawnMock).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("calls driver.importResults in real mode and persists the imported run id", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-import-real-"));
    const worker = new SunoBrowserWorker(root);
    const driver = createDriver({
      importResults: vi.fn(async ({ runId, urls }) => ({
        accepted: true,
        runId,
        urls,
        paths: ["runtime/suno/run-real-import/song-1.mp3"],
        importedAt: "2026-04-22T00:00:00.000Z"
      }))
    });

    await worker.start({ driver });
    const result = await worker.importRun("run-real-import", ["https://example.com/song-1"], { driver });
    const status = await worker.status();

    expect(driver.importResults).toHaveBeenCalledTimes(1);
    expect(result.runId).toBe("run-real-import");
    expect(result.urls).toEqual(["https://example.com/song-1"]);
    expect(result.paths).toEqual(["runtime/suno/run-real-import/song-1.mp3"]);
    expect(status.state).toBe("connected");
    expect(status.lastImportedRunId).toBe("run-real-import");
    expect(spawnMock).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("persists explicit per-URL import failures from the driver", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-import-failed-urls-"));
    const worker = new SunoBrowserWorker(root);
    const urls = ["https://suno.com/song/ok", "https://suno.com/song/missing"];
    const driver = createDriver({
      importResults: vi.fn(async ({ runId }) => ({
        accepted: true,
        runId,
        urls: [urls[0]!],
        paths: ["runtime/suno/run-failed-urls/ok.mp3"],
        metadata: [
          {
            url: urls[0]!,
            path: "runtime/suno/run-failed-urls/ok.mp3",
            format: "mp3" as const
          }
        ],
        failedUrls: [
          {
            url: urls[1]!,
            reason: "404" as const
          }
        ],
        importedAt: "2026-04-22T00:00:00.000Z",
        reason: "partial import"
      }))
    });

    await worker.start({ driver });
    const result = await worker.importRun("run-failed-urls", urls, { driver });
    const status = await worker.status();

    expect(result.failedUrls).toEqual([{ url: urls[1], reason: "404" }]);
    expect(status.lastImportOutcome?.failedUrls).toEqual([{ url: urls[1], reason: "404" }]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("infers failed URLs when a driver returns fewer imported metadata entries", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-import-infer-failures-"));
    const worker = new SunoBrowserWorker(root);
    const urls = ["https://suno.com/song/ok", "https://suno.com/song/network-fail"];
    const driver = createDriver({
      importResults: vi.fn(async ({ runId }) => ({
        accepted: true,
        runId,
        urls: [urls[0]!],
        paths: ["runtime/suno/run-infer-failures/ok.mp3"],
        metadata: [
          {
            url: urls[0]!,
            path: "runtime/suno/run-infer-failures/ok.mp3",
            format: "mp3" as const
          }
        ],
        importedAt: "2026-04-22T00:00:00.000Z",
        reason: "network timeout while importing one URL"
      }))
    });

    await worker.start({ driver });
    const result = await worker.importRun("run-infer-failures", urls, { driver });

    expect(result.failedUrls).toEqual([{ url: urls[1], reason: "network" }]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("routes connector create/import through worker methods", async () => {
    const status = vi.fn(async () => ({
      state: "connected" as const,
      connected: true
    }));
    const startCreate = vi.fn(async () => ({
      accepted: false,
      runId: "run-connector-create",
      reason: "dry-run blocks Suno create",
      urls: [],
      dryRun: true
    }));
    const importRun = vi.fn(async () => ({
      accepted: false,
      runId: "run-connector-import",
      urls: [],
      paths: [],
      reason: "dry-run blocks Suno import",
      dryRun: true
    }));
    const connector = new BrowserWorkerSunoConnector(".", {
      status,
      startCreate,
      importRun
    });

    const createResult = await connector.create({
      dryRun: true,
      authority: "auto_create_and_select_take",
      payload: { style: "test" },
      runId: "run-connector-create"
    });
    const importResult = await connector.importResults({
      runId: "run-connector-import",
      urls: ["https://example.com/song-1"]
    });

    expect(startCreate).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-connector-create" }),
      { dryRun: true }
    );
    expect(importRun).toHaveBeenCalledWith("run-connector-import", ["https://example.com/song-1"]);
    expect(createResult.runId).toBe("run-connector-create");
    expect(importResult.runId).toBe("run-connector-import");
    expect(spawnMock).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("exposes create/import outcomes through /api/suno/status", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-status-"));
    const worker = new SunoBrowserWorker(root);
    const driver = createDriver({
      create: vi.fn(async (request) => ({
        accepted: true,
        runId: request.runId ?? "run-status-create",
        reason: "mock create accepted",
        urls: []
      })),
      importResults: vi.fn(async ({ runId, urls }) => ({
        accepted: true,
        runId,
        urls,
        paths: ["runtime/suno/run-status-import/song-1.mp3"],
        importedAt: "2026-04-22T00:00:00.000Z",
        reason: "mock import complete"
      }))
    });

    await worker.start({ driver });
    await worker.startCreate(
      {
        dryRun: false,
        authority: "auto_create_and_select_take",
        payload: { style: "test" },
        runId: "run-status-create"
      },
      { driver }
    );
    await worker.importRun("run-status-import", ["https://example.com/song-1"], { driver });

    const status = await buildSunoStatusResponse({ artist: { workspaceRoot: root } });

    expect(status.currentRunId).toBe("run-status-import");
    expect(status.lastImportedRunId).toBe("run-status-import");
    expect(status.lastCreateOutcome).toMatchObject({
      runId: "run-status-create",
      accepted: true,
      reason: "mock create accepted"
    });
    expect(status.lastImportOutcome).toMatchObject({
      runId: "run-status-import",
      urlCount: 1,
      reason: "mock import complete"
    });
    expect(spawnMock).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
