import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultArtistRuntimeConfig } from "../src/config/defaultConfig";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { createAndPersistSunoPromptPack } from "../src/services/sunoPromptPackFiles";
import { generateSunoRun } from "../src/services/sunoRuns";

const { connectorStatusMock, connectorCreateMock } = vi.hoisted(() => ({
  connectorStatusMock: vi.fn(),
  connectorCreateMock: vi.fn()
}));

vi.mock("../src/connectors/suno/browserWorkerConnector.js", () => ({
  BrowserWorkerSunoConnector: vi.fn().mockImplementation(() => ({
    status: connectorStatusMock,
    create: connectorCreateMock,
    importResults: vi.fn()
  }))
}));

describe("generateSunoRun worker status resilience", () => {
  beforeEach(() => {
    connectorStatusMock.mockReset();
    connectorCreateMock.mockReset();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Regression: a nullish worker status (e.g. a corrupt/absent suno-worker.json) must not
  // throw "Cannot read properties of undefined (reading 'state')" while deciding authority.
  // That TypeError previously leaked into retry classification as
  // `suno_generate_retry:Cannot read properties of undefined (reading 'state')`.
  it("does not throw when connector.status() resolves to undefined", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-worker-status-"));
    await ensureArtistWorkspace(root);
    await createAndPersistSunoPromptPack({
      workspaceRoot: root,
      songId: "song-001",
      songTitle: "Ghost Station",
      artistReason: "worker status resilience",
      lyricsText: "static signal",
      knowledgePackVersion: "test-pack"
    });

    connectorStatusMock.mockResolvedValue(undefined);
    connectorCreateMock.mockResolvedValue({
      accepted: false,
      runId: "should-not-be-used",
      reason: "playwright_create_dom_missing: locator.waitFor timeout",
      urls: []
    });

    const run = await generateSunoRun({
      workspaceRoot: root,
      songId: "song-001",
      config: {
        autopilot: {
          ...defaultArtistRuntimeConfig.autopilot,
          dryRun: false
        },
        music: {
          ...defaultArtistRuntimeConfig.music,
          suno: {
            ...defaultArtistRuntimeConfig.music.suno,
            submitMode: "live"
          }
        }
      }
    });

    expect(run.runId).toBeTruthy();
    expect(run.status).not.toBe("accepted");
  });
});
