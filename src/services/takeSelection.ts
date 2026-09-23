import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TakeSelectionRecord } from "../types.js";
import { updateSongState } from "./artistState.js";
import { appendPromptLedger, createPromptLedgerEntry, getSongPromptLedgerPath } from "./promptLedger.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";
import { evaluateSunoTakeSelection } from "./sunoTakeSelector.js";
import { evaluateSunoTakeUrlReadiness } from "./sunoTakeUrls.js";
import { extractSunoTakeId } from "./takeAttributionGuard.js";

export interface SelectTakeInput {
  workspaceRoot: string;
  songId: string;
  runId?: string;
  selectedTakeId?: string;
  reason?: string;
  conversational?: boolean;
  producerDecision?: boolean;
}

export interface SongTakeReference {
  runId: string;
  createdAt: string;
  takeId: string;
  url: string;
  urlReady: boolean;
  readiness: ReturnType<typeof evaluateSunoTakeUrlReadiness>;
  selected: boolean;
  selection?: TakeSelectionRecord;
}

function inferTakeId(url: string, index: number): string {
  const lastSegment = url.split("/").filter(Boolean).at(-1);
  return lastSegment ? lastSegment.replace(/[^a-zA-Z0-9_-]/g, "-") : `take-${index + 1}`;
}

function takeHistoryPath(root: string, songId: string): string {
  return join(root, "songs", songId, "suno", "take-history.jsonl");
}

function takeIdForUrl(url: string, index: number): string {
  return extractSunoTakeId(url) ?? inferTakeId(url, index);
}

function assertSafeIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`invalid ${label}`);
  }
}

export async function listSongTakes(root: string, songId: string): Promise<SongTakeReference[]> {
  assertSafeIdentifier(songId, "songId");
  const runsPath = join(root, "songs", songId, "suno", "runs.jsonl");
  const rawRuns = (await readFile(runsPath, "utf8").catch(() => ""))
    .split("\n").filter(Boolean).map((line) => JSON.parse(line) as { runId: string; createdAt: string; status: string; urls: string[] });
  const selections = await readTakeHistory(root, songId);
  const latestResultsPath = join(root, "songs", songId, "suno", "latest-results.json");
  const latestResults = JSON.parse(await readFile(latestResultsPath, "utf8").catch(() => "{}")) as {
    runId?: string;
    urls?: string[];
  };
  const latestRunById = new Map<string, (typeof rawRuns)[number]>();
  for (const run of [...rawRuns].reverse()) {
    if (!latestRunById.has(run.runId)) {
      latestRunById.set(run.runId, run);
    }
  }
  const authoritativeRuns = Array.from(latestRunById.values())
    .filter((run) => (run.status === "accepted" || run.status === "imported") && run.urls.length > 0);
  const persistedRuns = rawRuns.length > 0 ? authoritativeRuns.sort((left, right) => right.createdAt.localeCompare(left.createdAt)) : latestResults.urls?.length
    ? [{ runId: latestResults.runId ?? "run-unknown", createdAt: new Date(0).toISOString(), urls: latestResults.urls }]
    : [];
  const references: SongTakeReference[] = [];
  for (const run of persistedRuns) {
    const readiness = evaluateSunoTakeUrlReadiness(run.urls, Date.parse(run.createdAt));
    run.urls.forEach((url, index) => {
      const takeId = takeIdForUrl(url, index);
      const selection = selections.find((entry) => entry.runId === run.runId && entry.selectedTakeId === takeId);
      references.push({
        runId: run.runId,
        createdAt: run.createdAt,
        takeId,
        url,
        urlReady: readiness.emit && readiness.urls.includes(url),
        readiness,
        selected: Boolean(selection),
        selection
      });
    });
  }
  return references;
}

export async function readTakeHistory(root: string, songId: string): Promise<TakeSelectionRecord[]> {
  const contents = await readFile(takeHistoryPath(root, songId), "utf8").catch(() => "");
  return contents
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TakeSelectionRecord)
    .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));
}

export async function selectTake(input: SelectTakeInput): Promise<TakeSelectionRecord> {
  assertSafeIdentifier(input.songId, "songId");
  if (input.runId) assertSafeIdentifier(input.runId, "runId");
  if (input.selectedTakeId) assertSafeIdentifier(input.selectedTakeId, "selectedTakeId");
  const latestResultsPath = join(input.workspaceRoot, "songs", input.songId, "suno", "latest-results.json");
  const latestResults = JSON.parse(await readFile(latestResultsPath, "utf8").catch(() => "{}")) as {
    runId?: string;
    urls?: string[];
    selectedTakeId?: string;
  };
  const urls = Array.isArray(latestResults.urls) ? latestResults.urls : [];
  const explicitHistorySelection = input.runId !== undefined || input.selectedTakeId !== undefined;
  if (urls.length === 0 && !explicitHistorySelection) {
    throw new Error(`no imported Suno results available for ${input.songId}`);
  }

  const history = explicitHistorySelection ? await listSongTakes(input.workspaceRoot, input.songId) : [];
  const requested = input.selectedTakeId;
  const candidates = input.runId ? history.filter((take) => take.runId === input.runId) : history;
  if (input.runId && candidates.length === 0) {
    throw new Error(`unknown Suno run ${input.runId} for ${input.songId}`);
  }
  const matched = requested ? candidates.find((take) => take.takeId === requested) : candidates[0];
  if (requested && !matched) {
    throw new Error(`take ${requested} is not recorded for ${input.songId}${input.runId ? ` in run ${input.runId}` : ""}`);
  }
  const decision = explicitHistorySelection ? undefined : await evaluateSunoTakeSelection(input.workspaceRoot, input.songId);
  const selectedTakeId = matched?.takeId ?? input.selectedTakeId ?? latestResults.selectedTakeId ?? (decision && decision.status !== "pending" ? decision.best.takeId : inferTakeId(urls[0], 0));
  const runId = matched?.runId ?? input.runId ?? latestResults.runId ?? "run-unknown";
  const sourceUrls = matched ? history.filter((take) => take.runId === matched.runId).map((take) => take.url) : urls;
  const existing = (await readTakeHistory(input.workspaceRoot, input.songId)).find((entry) => entry.runId === runId && entry.selectedTakeId === selectedTakeId);
  const current = JSON.parse(await readFile(join(input.workspaceRoot, "songs", input.songId, "suno", "selected-take.json"), "utf8").catch(() => "{}")) as Partial<TakeSelectionRecord>;
  if (existing && current.runId === runId && current.selectedTakeId === selectedTakeId) {
    return existing;
  }
  const reason = input.reason ?? (decision?.status === "selected" ? `selected best scored take (${decision.best.total})` : "selected imported take");
  const record: TakeSelectionRecord = {
    songId: input.songId,
    runId,
    selectedTakeId,
    reason,
    sourceUrls,
    verification: { status: "verified", detail: reason },
    createdAt: new Date().toISOString()
  };

  const outputPath = join(input.workspaceRoot, "songs", input.songId, "suno", "selected-take.json");
  await mkdir(join(input.workspaceRoot, "songs", input.songId, "suno"), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await appendFile(takeHistoryPath(input.workspaceRoot, input.songId), `${JSON.stringify(record)}\n`, "utf8");
  await appendPromptLedger(
    getSongPromptLedgerPath(input.workspaceRoot, input.songId),
    createPromptLedgerEntry({
      stage: "take_selection",
      songId: input.songId,
      runId,
      actor: "artist",
      inputRefs: [runId === latestResults.runId || runId === "run-unknown"
        ? latestResultsPath
        : join(input.workspaceRoot, "songs", input.songId, "suno", `${runId}.results.json`)],
      outputRefs: [outputPath],
      outputSummary: selectedTakeId,
      verification: record.verification
    })
  );
  await updateSongState(input.workspaceRoot, input.songId, {
    status: "take_selected",
    reason,
    selectedTakeId,
    appendPublicLinks: sourceUrls
  });
  if (!input.conversational && !input.producerDecision) {
    emitRuntimeEvent({
      type: "autopilot_stage_changed",
      songId: input.songId,
      from: "take_selection",
      to: "asset_generation",
      timestamp: Date.now()
    });
  }

  return record;
}
