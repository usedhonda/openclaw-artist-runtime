import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { scoreSunoTakes, type SunoTakeScore } from "./sunoTakeScorer.js";

export type SunoTakeSelectionDecision =
  | { status: "selected"; best: SunoTakeScore; scores: SunoTakeScore[]; runId: string }
  | { status: "low_score"; best: SunoTakeScore; scores: SunoTakeScore[]; runId: string; reason: string }
  | { status: "pending"; scores: SunoTakeScore[]; runId: string; reason: string };

export function selectBestScoredTake(scores: SunoTakeScore[], threshold = 0.5): SunoTakeSelectionDecision {
  if (scores.length === 0) {
    return { status: "pending", scores, runId: "run-unknown", reason: "no_imported_takes" };
  }
  const best = [...scores].sort((left, right) => right.total - left.total || left.takeId.localeCompare(right.takeId))[0];
  if (best.total < threshold) {
    return { status: "low_score", best, scores, runId: "run-unknown", reason: `best_take_below_threshold:${best.total}` };
  }
  return { status: "selected", best, scores, runId: "run-unknown" };
}

export async function evaluateSunoTakeSelection(root: string, songId: string, threshold = 0.5): Promise<SunoTakeSelectionDecision> {
  const sunoRoot = join(root, "songs", songId, "suno");
  const latest = JSON.parse(await readFile(join(sunoRoot, "latest-results.json"), "utf8").catch(() => "{}")) as { runId?: string; urls?: string[] };
  const urls = Array.isArray(latest.urls) ? latest.urls : [];
  const [briefText, lyricsText] = await Promise.all([
    readFile(join(root, "songs", songId, "brief.md"), "utf8").catch(() => ""),
    readFile(join(root, "songs", songId, "lyrics", "lyrics.v1.md"), "utf8").catch(() => "")
  ]);
  const decision = selectBestScoredTake(scoreSunoTakes({ urls, briefText, lyricsText }), threshold);
  return { ...decision, runId: latest.runId ?? decision.runId };
}
