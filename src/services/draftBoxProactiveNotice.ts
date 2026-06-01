import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readAutopilotState } from "./autopilotRecovery.js";
import { composeDraftBoxNextAction } from "./draftBoxNextAction.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";
import type { AutopilotRunState } from "../types.js";

export interface DraftBoxProactiveNoticeEntry {
  stateKey: string;
  kind: "draft_idle" | "suno_trouble";
  songId?: string;
  title?: string;
  reason?: string;
  notifiedAt: string;
}

export function draftBoxProactiveNoticeLedgerPath(root: string): string {
  return join(root, "runtime", "draft-box-proactive-notices.jsonl");
}

async function readNoticeKeys(root: string): Promise<Set<string>> {
  const contents = await readFile(draftBoxProactiveNoticeLedgerPath(root), "utf8").catch(() => "");
  return new Set(contents
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as DraftBoxProactiveNoticeEntry)
    .map((entry) => entry.stateKey));
}

async function appendNotice(root: string, entry: DraftBoxProactiveNoticeEntry): Promise<void> {
  const path = draftBoxProactiveNoticeLedgerPath(root);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
}

export async function emitDraftBoxProactiveNoticeIfNeeded(
  root: string,
  state?: AutopilotRunState
): Promise<boolean> {
  const targetState = state ?? await readAutopilotState(root);
  const summary = await composeDraftBoxNextAction(root, { state: targetState });
  if (summary.kind !== "draft_idle" && summary.kind !== "suno_trouble") {
    return false;
  }
  const keys = await readNoticeKeys(root);
  if (keys.has(summary.stateKey)) {
    return false;
  }
  const entry: DraftBoxProactiveNoticeEntry = {
    stateKey: summary.stateKey,
    kind: summary.kind,
    songId: summary.songId,
    title: summary.title,
    reason: summary.reason,
    notifiedAt: new Date().toISOString()
  };
  await appendNotice(root, entry);
  emitRuntimeEvent({
    type: "artist_proactive_notice",
    trigger: summary.kind,
    message: summary.kind === "draft_idle"
      ? "手が空いてる。草稿箱から作る?"
      : "Suno に今つながってない、または timeout で詰まってる。整えて。",
    nextAction: summary.nextAction,
    draftCount: summary.draftCount,
    buildingCount: summary.buildingCount,
    songId: summary.songId,
    title: summary.title,
    reason: summary.reason,
    stateKey: summary.stateKey,
    timestamp: Date.now()
  });
  return true;
}
