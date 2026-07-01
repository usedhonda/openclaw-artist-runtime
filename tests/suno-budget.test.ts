import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultArtistRuntimeConfig } from "../src/config/defaultConfig";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { createAndPersistSunoPromptPack } from "../src/services/sunoPromptPackFiles";
import {
  DEFAULT_SUNO_DAILY_CREDIT_LIMIT,
  SUNO_BUDGET_EXHAUSTED_REASON,
  SUNO_MONTHLY_BUDGET_EXHAUSTED_REASON,
  SunoBudgetTracker
} from "../src/services/sunoBudget";
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

describe("SunoBudgetTracker", () => {
  beforeEach(() => {
    connectorStatusMock.mockReset();
    connectorCreateMock.mockReset();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("persists consumed credits when a reserve fits under the daily limit", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-budget-"));
    const tracker = new SunoBudgetTracker(root, () => new Date("2026-04-23T00:00:00.000Z"));

    const result = await tracker.reserve(10, DEFAULT_SUNO_DAILY_CREDIT_LIMIT);
    const persisted = JSON.parse(await readFile(join(root, "runtime", "suno", "budget.json"), "utf8")) as {
      date: string;
      consumed: number;
    };

    expect(result).toEqual({
      ok: true,
      consumed: 10,
      limit: DEFAULT_SUNO_DAILY_CREDIT_LIMIT,
      monthlyConsumed: 10,
      monthlyLimit: 0
    });
    expect(persisted).toMatchObject({
      date: "2026-04-23",
      consumed: 10,
      month: "2026-04",
      monthlyConsumed: 10
    });
  });

  it("blocks live submit before connector.create when the daily limit would be exceeded", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"));

    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-budget-block-"));
    await ensureArtistWorkspace(root);
    await createAndPersistSunoPromptPack({
      workspaceRoot: root,
      songId: "song-001",
      songTitle: "Ghost Station",
      artistReason: "budget edge",
      lyricsText: "static signal",
      knowledgePackVersion: "test-pack"
    });
    await mkdir(join(root, "runtime", "suno"), { recursive: true });
    await writeFile(
      join(root, "runtime", "suno", "budget.json"),
      `${JSON.stringify({ date: "2026-04-23", consumed: 55 }, null, 2)}\n`,
      "utf8"
    );
    connectorStatusMock.mockResolvedValue({ state: "connected" });
    connectorCreateMock.mockResolvedValue({
      accepted: true,
      runId: "unexpected",
      reason: "unexpected",
      urls: ["https://suno.com/song/unexpected"]
    });

    const result = await generateSunoRun({
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
            submitMode: "live",
            dailyCreditLimit: 60
          }
        }
      }
    });
    const persisted = JSON.parse(await readFile(join(root, "runtime", "suno", "budget.json"), "utf8")) as {
      date: string;
      consumed: number;
    };

    expect(connectorCreateMock).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.error?.message).toBe(SUNO_BUDGET_EXHAUSTED_REASON);
    expect(persisted).toEqual({
      date: "2026-04-23",
      consumed: 55
    });
  });

  it("blocks live submit when one create would exceed the daily credit limit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"));

    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-budget-single-create-"));
    await ensureArtistWorkspace(root);
    await createAndPersistSunoPromptPack({
      workspaceRoot: root,
      songId: "song-001",
      songTitle: "Credit Wall",
      artistReason: "credit edge",
      lyricsText: "static signal",
      knowledgePackVersion: "test-pack"
    });
    connectorStatusMock.mockResolvedValue({ state: "connected" });
    connectorCreateMock.mockResolvedValue({
      accepted: true,
      runId: "unexpected",
      reason: "unexpected",
      urls: ["https://suno.com/song/unexpected"]
    });

    const result = await generateSunoRun({
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
            submitMode: "live",
            dailyCreditLimit: 9
          }
        }
      }
    });

    expect(connectorCreateMock).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.error?.message).toBe(SUNO_BUDGET_EXHAUSTED_REASON);
  });

  it("resets the counter on the next UTC day before reserving again", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-budget-reset-"));
    await mkdir(join(root, "runtime", "suno"), { recursive: true });
    await writeFile(
      join(root, "runtime", "suno", "budget.json"),
      `${JSON.stringify({ date: "2026-04-22", consumed: 60 }, null, 2)}\n`,
      "utf8"
    );
    const tracker = new SunoBudgetTracker(root, () => new Date("2026-04-23T00:00:00.000Z"));

    const result = await tracker.reserve(10, DEFAULT_SUNO_DAILY_CREDIT_LIMIT);
    const persisted = JSON.parse(await readFile(join(root, "runtime", "suno", "budget.json"), "utf8")) as {
      date: string;
      consumed: number;
    };

    expect(result).toEqual({
      ok: true,
      consumed: 10,
      limit: DEFAULT_SUNO_DAILY_CREDIT_LIMIT,
      monthlyConsumed: 70,
      monthlyLimit: 0
    });
    expect(persisted).toMatchObject({
      date: "2026-04-23",
      consumed: 10,
      month: "2026-04",
      monthlyConsumed: 70
    });
  });

  it("falls back to an empty state when budget.json contains invalid JSON", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-budget-invalid-json-"));
    await mkdir(join(root, "runtime", "suno"), { recursive: true });
    await writeFile(join(root, "runtime", "suno", "budget.json"), "{not-valid-json", "utf8");
    const tracker = new SunoBudgetTracker(root, () => new Date("2026-04-23T00:00:00.000Z"));

    const state = await tracker.getState(DEFAULT_SUNO_DAILY_CREDIT_LIMIT);
    const reserve = await tracker.reserve(10, DEFAULT_SUNO_DAILY_CREDIT_LIMIT);
    const persisted = JSON.parse(await readFile(join(root, "runtime", "suno", "budget.json"), "utf8")) as {
      date: string;
      consumed: number;
    };

    expect(state).toEqual({
      date: "2026-04-23",
      consumed: 0,
      limit: DEFAULT_SUNO_DAILY_CREDIT_LIMIT,
      remaining: DEFAULT_SUNO_DAILY_CREDIT_LIMIT,
      monthly: {
        month: "2026-04",
        consumed: 0,
        limit: 0,
        remaining: 0,
        unlimited: true
      }
    });
    expect(reserve).toEqual({
      ok: true,
      consumed: 10,
      limit: DEFAULT_SUNO_DAILY_CREDIT_LIMIT,
      monthlyConsumed: 10,
      monthlyLimit: 0
    });
    expect(persisted).toMatchObject({
      date: "2026-04-23",
      consumed: 10,
      month: "2026-04",
      monthlyConsumed: 10
    });
  });

  it("writes through a temporary file and leaves only the final budget.json behind", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-budget-atomic-"));
    const tracker = new SunoBudgetTracker(root, () => new Date("2026-04-23T00:00:00.000Z"));

    const result = await tracker.reserve(10, DEFAULT_SUNO_DAILY_CREDIT_LIMIT);
    const finalPath = join(root, "runtime", "suno", "budget.json");
    const tmpPath = `${finalPath}.tmp`;
    const finalContents = JSON.parse(await readFile(finalPath, "utf8")) as {
      date: string;
      consumed: number;
    };
    const tmpExists = await access(tmpPath).then(() => true).catch(() => false);

    expect(result).toEqual({
      ok: true,
      consumed: 10,
      limit: DEFAULT_SUNO_DAILY_CREDIT_LIMIT,
      monthlyConsumed: 10,
      monthlyLimit: 0
    });
    expect(finalContents).toMatchObject({
      date: "2026-04-23",
      consumed: 10,
      month: "2026-04",
      monthlyConsumed: 10
    });
    expect(tmpExists).toBe(false);
  });

  it("cleans stale temporary state files after the next successful write", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-budget-stale-tmp-"));
    await mkdir(join(root, "runtime", "suno"), { recursive: true });
    await writeFile(join(root, "runtime", "suno", "budget.json.tmp"), "{partial", "utf8");
    const tracker = new SunoBudgetTracker(root, () => new Date("2026-04-23T00:00:00.000Z"));

    await tracker.reserve(10, DEFAULT_SUNO_DAILY_CREDIT_LIMIT);

    const tmpExists = await access(join(root, "runtime", "suno", "budget.json.tmp")).then(() => true).catch(() => false);
    expect(tmpExists).toBe(false);
  });

  it("resets the current UTC-day budget counter to zero and records the reset audit line", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-budget-manual-reset-"));
    await mkdir(join(root, "runtime", "suno"), { recursive: true });
    await writeFile(
      join(root, "runtime", "suno", "budget.json"),
      `${JSON.stringify({ date: "2026-04-23", consumed: 45 }, null, 2)}\n`,
      "utf8"
    );
    const tracker = new SunoBudgetTracker(root, () => new Date("2026-04-23T12:00:00.000Z"));

    const state = await tracker.reset(DEFAULT_SUNO_DAILY_CREDIT_LIMIT, 120, "operator_test_reset");
    const persisted = JSON.parse(await readFile(join(root, "runtime", "suno", "budget.json"), "utf8")) as {
      date: string;
      consumed: number;
      lastResetAt?: string;
    };
    const resetLog = JSON.parse((await readFile(join(root, "runtime", "suno", "budget-reset.jsonl"), "utf8")).trim()) as {
      timestamp: string;
      consumedBefore: number;
      reason: string;
    };

    expect(state).toMatchObject({
      date: "2026-04-23",
      consumed: 0,
      limit: DEFAULT_SUNO_DAILY_CREDIT_LIMIT,
      remaining: DEFAULT_SUNO_DAILY_CREDIT_LIMIT,
      lastResetAt: "2026-04-23T12:00:00.000Z",
      monthly: {
        month: "2026-04",
        consumed: 45,
        limit: 120,
        remaining: 75,
        unlimited: false
      }
    });
    expect(persisted).toMatchObject({
      date: "2026-04-23",
      consumed: 0,
      lastResetAt: "2026-04-23T12:00:00.000Z"
    });
    expect(resetLog).toEqual({
      timestamp: "2026-04-23T12:00:00.000Z",
      consumedBefore: 45,
      reason: "operator_test_reset"
    });
  });

  it("reads recent reset history newest first and skips malformed jsonl lines", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-budget-reset-history-"));
    await mkdir(join(root, "runtime", "suno"), { recursive: true });
    await writeFile(
      join(root, "runtime", "suno", "budget-reset.jsonl"),
      [
        JSON.stringify({ timestamp: "2026-04-21T00:00:00.000Z", consumedBefore: 30, reason: "old" }),
        "{not-json",
        JSON.stringify({ timestamp: "2026-04-22T00:00:00.000Z", consumedBefore: 20, reason: "middle" }),
        JSON.stringify({ timestamp: "2026-04-23T00:00:00.000Z", consumedBefore: 10, reason: "new" })
      ].join("\n"),
      "utf8"
    );
    const tracker = new SunoBudgetTracker(root, () => new Date("2026-04-23T12:00:00.000Z"));

    await expect(tracker.getResetHistory(2)).resolves.toEqual([
      { timestamp: "2026-04-23T00:00:00.000Z", consumedBefore: 10, reason: "new" },
      { timestamp: "2026-04-22T00:00:00.000Z", consumedBefore: 20, reason: "middle" }
    ]);
  });

  it("returns an empty reset history when the audit log is absent", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-budget-reset-history-empty-"));
    const tracker = new SunoBudgetTracker(root, () => new Date("2026-04-23T12:00:00.000Z"));

    await expect(tracker.getResetHistory(5)).resolves.toEqual([]);
  });

  it("leaves monthly credit enforcement bypassed when monthly limit is zero", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-budget-monthly-unlimited-"));
    await mkdir(join(root, "runtime", "suno"), { recursive: true });
    await writeFile(
      join(root, "runtime", "suno", "budget.json"),
      `${JSON.stringify({ date: "2026-04-23", consumed: 10, month: "2026-04", monthlyConsumed: 500 }, null, 2)}\n`,
      "utf8"
    );
    const tracker = new SunoBudgetTracker(root, () => new Date("2026-04-23T12:00:00.000Z"));

    const result = await tracker.reserve(10, DEFAULT_SUNO_DAILY_CREDIT_LIMIT, 0);

    expect(result.ok).toBe(true);
    expect(result.monthlyConsumed).toBe(510);
    expect(result.monthlyLimit).toBe(0);
  });

  it("fails closed before reservation when monthly credit limit would be exceeded", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-budget-monthly-block-"));
    await mkdir(join(root, "runtime", "suno"), { recursive: true });
    await writeFile(
      join(root, "runtime", "suno", "budget.json"),
      `${JSON.stringify({ date: "2026-04-23", consumed: 10, month: "2026-04", monthlyConsumed: 55 }, null, 2)}\n`,
      "utf8"
    );
    const tracker = new SunoBudgetTracker(root, () => new Date("2026-04-23T12:00:00.000Z"));

    const result = await tracker.reserve(10, DEFAULT_SUNO_DAILY_CREDIT_LIMIT, 60);
    const persisted = JSON.parse(await readFile(join(root, "runtime", "suno", "budget.json"), "utf8")) as {
      consumed: number;
      monthlyConsumed: number;
    };

    expect(result).toEqual({
      ok: false,
      consumed: 10,
      limit: DEFAULT_SUNO_DAILY_CREDIT_LIMIT,
      reason: SUNO_MONTHLY_BUDGET_EXHAUSTED_REASON,
      monthlyConsumed: 55,
      monthlyLimit: 60
    });
    expect(persisted).toMatchObject({
      consumed: 10,
      monthlyConsumed: 55
    });
  });

  it("blocks live submit before connector.create when the monthly limit would be exceeded", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"));

    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-budget-monthly-run-block-"));
    await ensureArtistWorkspace(root);
    await createAndPersistSunoPromptPack({
      workspaceRoot: root,
      songId: "song-001",
      songTitle: "Monthly Ghost",
      artistReason: "monthly budget edge",
      lyricsText: "meter runs out",
      knowledgePackVersion: "test-pack"
    });
    await mkdir(join(root, "runtime", "suno"), { recursive: true });
    await writeFile(
      join(root, "runtime", "suno", "budget.json"),
      `${JSON.stringify({ date: "2026-04-23", consumed: 10, month: "2026-04", monthlyConsumed: 55 }, null, 2)}\n`,
      "utf8"
    );
    connectorStatusMock.mockResolvedValue({ state: "connected" });
    connectorCreateMock.mockResolvedValue({
      accepted: true,
      runId: "unexpected",
      reason: "unexpected",
      urls: ["https://suno.com/song/unexpected"]
    });

    const result = await generateSunoRun({
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
            submitMode: "live",
            dailyCreditLimit: 60,
            monthlyCreditLimit: 60
          }
        }
      }
    });

    expect(connectorCreateMock).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.error?.message).toBe(SUNO_MONTHLY_BUDGET_EXHAUSTED_REASON);
  });
});
