import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { registerRoutes } from "../src/routes";
import { AutopilotTicker } from "../src/services/autopilotTicker";
import { createAndPersistSunoPromptPack } from "../src/services/sunoPromptPackFiles";
import { generateSunoRun } from "../src/services/sunoRuns";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { readAutopilotRunState, writeAutopilotRunState } from "../src/services/autopilotService";
import { ArtistAutopilotService } from "../src/services/autopilotService";
import { SunoBrowserWorker, type SunoBrowserDriver } from "../src/services/sunoBrowserWorker";

function makeWorkspace(prefix = "artist-runtime-autopilot-revival-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function createMockRequest(method: string, url: string, body?: string): IncomingMessage {
  const req = Readable.from(body ? [body] : []) as IncomingMessage;
  req.method = method;
  req.url = url;
  req.headers = body ? { "content-type": "application/json" } : {};
  return req;
}

function createMockResponse() {
  let body = "";
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    headersSent: false,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return this;
    },
    end(chunk?: string | Buffer) {
      if (chunk) {
        body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      }
      this.headersSent = true;
      return this;
    }
  } as unknown as ServerResponse;

  return {
    res,
    readBody: () => body,
    readHeader: (name: string) => headers[name.toLowerCase()],
    readStatus: () => (res as unknown as { statusCode: number }).statusCode
  };
}

function routeRegistry(): Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void> {
  const registered = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void>();
  registerRoutes({
    registerHttpRoute(definition: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void }) {
      registered.set(definition.path, definition.handler);
    }
  });
  return registered;
}

async function seedPromptPack(root: string, songId = "song-001"): Promise<void> {
  await ensureArtistWorkspace(root);
  await createAndPersistSunoPromptPack({
    workspaceRoot: root,
    songId,
    songTitle: "Ghost Station",
    artistReason: "autopilot revival test",
    lyricsText: "dead neon under station glass",
    knowledgePackVersion: "test-pack"
  });
}

describe("autopilot revival smoke coverage", () => {
  it("keeps explicitly disabled config as a ticker no-op", async () => {
    const root = makeWorkspace();
    await mkdir(join(root, "runtime"), { recursive: true });
    const outcomes: string[] = [];
    const ticker = new AutopilotTicker({ onOutcome: (outcome) => outcomes.push(outcome) });

    const result = await ticker.runNow({ artist: { workspaceRoot: root }, autopilot: { enabled: false } });

    expect(result.outcome).toBe("skipped:disabled");
    expect(outcomes).toEqual(["skipped:disabled"]);
    expect(result.state.stage).toBe("idle");
    expect(result.state.paused).toBe(false);
  });

  it("stops at musicAuthority deny and does not call the Suno create layer", async () => {
    const root = makeWorkspace();
    await seedPromptPack(root);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const generated = await generateSunoRun({
      workspaceRoot: root,
      songId: "song-001",
      config: {
        artist: { workspaceRoot: root },
        autopilot: { dryRun: true },
        music: { suno: { driver: "playwright" as const, submitMode: "live", authority: "auto_create_and_select_take" } }
      }
    });
    const runLog = await readFile(join(root, "songs", "song-001", "suno", "runs.jsonl"), "utf8");
    const promptLedger = await readFile(join(root, "songs", "song-001", "prompts", "prompt-ledger.jsonl"), "utf8");

    expect(generated.status).toBe("blocked_dry_run");
    expect(generated.authorityDecision.policyDecision).toBe("deny_dry_run");
    expect(generated.error?.message).toBeUndefined();
    expect(promptLedger).toContain("\"stage\":\"suno_prepare_to_create\"");
    expect(runLog).toContain("\"status\":\"blocked_dry_run\"");
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("smokes an autopilot dry-run cycle through prompt pack generation while both Suno gates stay closed", async () => {
    const root = makeWorkspace();
    await ensureArtistWorkspace(root);
    const service = new ArtistAutopilotService();
    const config = {
      artist: { workspaceRoot: root },
      autopilot: { enabled: true, dryRun: true },
      music: { suno: { driver: "playwright" as const, submitMode: "live", authority: "auto_create_and_select_take" } }
    };

    const planning = await service.runCycle({ workspaceRoot: root, config });
    const songId = planning.currentSongId ?? "song-001";
    const promptPack = await service.runCycle({ workspaceRoot: root, config });
    const suno = await service.runCycle({ workspaceRoot: root, config });

    const metadata = await readFile(join(root, "songs", songId, "prompts", "prompt-pack-v001", "metadata.json"), "utf8");
    const runLog = await readFile(join(root, "songs", songId, "suno", "runs.jsonl"), "utf8");

    expect(promptPack.lastSuccessfulStage).toBe("prompt_pack");
    expect(metadata).toContain("\"version\": 1");
    expect(suno.stage).toBe("suno_generation");
    expect(suno.blockedReason).toBe("waiting for Suno result import");
    expect(runLog).toContain("\"policyDecision\":\"deny_dry_run\"");
    expect(runLog).toContain("\"status\":\"blocked_dry_run\"");

    const driverCreate = vi.fn(async () => ({
      accepted: true,
      runId: "should-not-run",
      reason: "unexpected",
      urls: []
    }));
    const worker = new SunoBrowserWorker(root);
    const workerResult = await worker.startCreate(
      {
        dryRun: true,
        authority: "auto_create_and_select_take",
        payload: { style: "ghost station" },
        songId,
        runId: "worker-dry-run"
      },
      {
        dryRun: true,
        driver: {
          async create(request) {
            return driverCreate(request);
          }
        } satisfies SunoBrowserDriver
      }
    );

    expect(workerResult).toMatchObject({
      accepted: false,
      runId: "worker-dry-run",
      reason: "dry-run blocks Suno create",
      dryRun: true
    });
    expect(driverCreate).not.toHaveBeenCalled();
  });

  it("routes pause and resume through the control-service-backed legacy exports", async () => {
    const root = makeWorkspace();
    await mkdir(join(root, "runtime"), { recursive: true });
    await writeAutopilotRunState(root, {
      runId: "route-run",
      stage: "suno_generation",
      paused: false,
      retryCount: 1,
      cycleCount: 2,
      updatedAt: "2026-04-27T08:00:00.000Z"
    });
    const routes = routeRegistry();
    const pauseHandler = routes.get("/plugins/artist-runtime/api/pause");
    const resumeHandler = routes.get("/plugins/artist-runtime/api/resume");
    expect(pauseHandler).toBeTruthy();
    expect(resumeHandler).toBeTruthy();

    const pauseResponse = createMockResponse();
    await pauseHandler?.(
      createMockRequest(
        "POST",
        "/plugins/artist-runtime/api/pause",
        JSON.stringify({ config: { artist: { workspaceRoot: root } }, reason: "route maintenance" })
      ),
      pauseResponse.res
    );
    const paused = JSON.parse(pauseResponse.readBody());
    expect(paused).toMatchObject({
      runId: "route-run",
      stage: "paused",
      paused: true,
      pausedReason: "route maintenance"
    });

    const resumeResponse = createMockResponse();
    await resumeHandler?.(
      createMockRequest("POST", "/plugins/artist-runtime/api/resume", JSON.stringify({ config: { artist: { workspaceRoot: root } } })),
      resumeResponse.res
    );
    const resumed = JSON.parse(resumeResponse.readBody());
    expect(resumed).toMatchObject({
      runId: "route-run",
      stage: "idle",
      paused: false
    });
  });

  it("routes resetState resume through backup and planning reset", async () => {
    const root = makeWorkspace();
    await mkdir(join(root, "runtime"), { recursive: true });
    await writeAutopilotRunState(root, {
      runId: "route-run",
      currentSongId: "song-001",
      stage: "failed_closed",
      paused: true,
      blockedReason: "selector mismatch",
      hardStopReason: "selector mismatch",
      pausedReason: "manual pause",
      retryCount: 5,
      cycleCount: 8,
      updatedAt: "2026-04-27T08:00:00.000Z"
    });
    const routes = routeRegistry();
    const resumeHandler = routes.get("/plugins/artist-runtime/api/resume");
    expect(resumeHandler).toBeTruthy();

    const response = createMockResponse();
    await resumeHandler?.(
      createMockRequest(
        "POST",
        "/plugins/artist-runtime/api/resume",
        JSON.stringify({
          config: { artist: { workspaceRoot: root } },
          resetState: true,
          reason: "operator reset"
        })
      ),
      response.res
    );
    const reset = JSON.parse(response.readBody());
    const persisted = await readAutopilotRunState(root);
    const runtimeFiles = readFileSync(join(root, "runtime", "autopilot-state.json"), "utf8");
    const backupFiles = await readdir(join(root, "runtime"));

    expect(reset).toMatchObject({
      stage: "planning",
      paused: false,
      retryCount: 0,
      cycleCount: 0,
      blockedReason: null,
      hardStopReason: null
    });
    expect(reset.runId).toBeUndefined();
    expect(reset.currentSongId).toBeUndefined();
    expect(persisted.stage).toBe("planning");
    expect(runtimeFiles).toContain("\"blockedReason\": null");
    expect(backupFiles.some((file) => /^autopilot-state\.backup\.\d{8}T\d{6}Z\.json$/.test(file))).toBe(true);
    expect(
      readFileSync(join(root, "runtime", "autopilot-state.json"), "utf8")
    ).toContain("\"stage\": \"planning\"");
  });
});
