import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TakeSelectionRecord } from "../types.js";
import { updateSongState } from "./artistState.js";
import { appendPromptLedger, createPromptLedgerEntry, getSongPromptLedgerPath } from "./promptLedger.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";
import { evaluateSunoTakeSelection } from "./sunoTakeSelector.js";

export interface SelectTakeInput {
  workspaceRoot: string;
  songId: string;
  runId?: string;
  selectedTakeId?: string;
  reason?: string;
}

function inferTakeId(url: string, index: number): string {
  const lastSegment = url.split("/").filter(Boolean).at(-1);
  return lastSegment ? lastSegment.replace(/[^a-zA-Z0-9_-]/g, "-") : `take-${index + 1}`;
}

function takeHistoryPath(root: string, songId: string): string {
  return join(root, "songs", songId, "suno", "take-history.jsonl");
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
  const latestResultsPath = join(input.workspaceRoot, "songs", input.songId, "suno", "latest-results.json");
  const latestResults = JSON.parse(await readFile(latestResultsPath, "utf8")) as {
    runId?: string;
    urls?: string[];
    selectedTakeId?: string;
  };
  const urls = Array.isArray(latestResults.urls) ? latestResults.urls : [];
  if (urls.length === 0) {
    throw new Error(`no imported Suno results available for ${input.songId}`);
  }

  const decision = await evaluateSunoTakeSelection(input.workspaceRoot, input.songId);
  const selectedTakeId = input.selectedTakeId ?? latestResults.selectedTakeId ?? (decision.status !== "pending" ? decision.best.takeId : inferTakeId(urls[0], 0));
  const runId = input.runId ?? latestResults.runId ?? "run-unknown";
  const reason = input.reason ?? (decision.status === "selected" ? `selected best scored take (${decision.best.total})` : "selected imported take");
  const record: TakeSelectionRecord = {
    songId: input.songId,
    runId,
    selectedTakeId,
    reason,
    sourceUrls: urls,
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
      inputRefs: [latestResultsPath],
      outputRefs: [outputPath],
      outputSummary: selectedTakeId,
      verification: record.verification
    })
  );
  await updateSongState(input.workspaceRoot, input.songId, {
    status: "take_selected",
    reason,
    selectedTakeId,
    appendPublicLinks: urls
  });
  emitRuntimeEvent({
    type: "autopilot_stage_changed",
    songId: input.songId,
    from: "take_selection",
    to: "asset_generation",
    timestamp: Date.now()
  });

  return record;
}
