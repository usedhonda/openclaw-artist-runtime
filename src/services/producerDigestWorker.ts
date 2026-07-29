import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ProducerDigestMode } from "../types.js";
import { TelegramClient, type TelegramFetch } from "./telegramClient.js";
import { readRuntimeEvents } from "./runtimeEventsLedger.js";
import { readAutopilotRunState } from "./autopilotService.js";
import type { RuntimeEvent } from "./runtimeEventBus.js";

// The producer digest is the one routine "everything is fine, here is what moved"
// message. Its whole purpose is to close the silence gap the producer feels when the
// runtime is healthy but quiet (a song parked waiting on Suno import emits no signal
// event). It is intentionally sent at most once per local calendar day; the marker
// file below is the dedup so a gateway bounce never re-sends the same day's digest.
export interface ProducerDigestWorkerOptions {
  root: string;
  token: string;
  chatIds: ReadonlyArray<string | number>;
  mode?: ProducerDigestMode;
  fetchImpl?: TelegramFetch;
  intervalMs?: number;
  now?: Date;
}

export interface ProducerDigestResult {
  delivered: boolean;
  skipped?: "mode" | "dedup" | "no_chat";
  dateKey?: string;
}

const DEFAULT_CHECK_INTERVAL_MS = 30 * 60 * 1000;
const DIGEST_WINDOW_MS = 24 * 60 * 60 * 1000;

function markerPath(root: string): string {
  return join(root, "runtime", "producer-digest-last-sent.txt");
}

// Local-calendar-day key. One digest per local day; comparing this string is the dedup.
function localDateKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function readLastSentDateKey(root: string): Promise<string | undefined> {
  const raw = await readFile(markerPath(root), "utf8").catch(() => "");
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function writeLastSentDateKey(root: string, dateKey: string): Promise<void> {
  const path = markerPath(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${dateKey}\n`, "utf8");
}

interface DigestCounts {
  takesCompleted: number;
  newProposals: number;
  sunoResults: number;
  humanAssist: number;
  blockers: number;
}

const BLOCKER_EVENT_TYPES: ReadonlySet<RuntimeEvent["type"]> = new Set([
  "suno_hard_stop",
  "suno_create_failed",
  "suno_generate_failed",
  "lyrics_generation_degraded",
  "take_selection_stalled",
  "asset_generation_stalled",
  "budget_exhausted",
  "planning_skeleton_incomplete"
]);

function countRecentEvents(events: RuntimeEvent[], sinceMs: number): DigestCounts {
  const counts: DigestCounts = { takesCompleted: 0, newProposals: 0, sunoResults: 0, humanAssist: 0, blockers: 0 };
  for (const event of events) {
    if (event.timestamp < sinceMs) continue;
    switch (event.type) {
      case "song_take_completed":
        counts.takesCompleted += 1;
        break;
      case "song_spawn_proposed":
        counts.newProposals += 1;
        break;
      case "suno_take_url_ready":
        counts.sunoResults += 1;
        break;
      case "suno_human_assist_requested":
        counts.humanAssist += 1;
        break;
      default:
        if (BLOCKER_EVENT_TYPES.has(event.type)) counts.blockers += 1;
    }
  }
  return counts;
}

async function composeNextLine(root: string): Promise<string> {
  const state = await readAutopilotRunState(root).catch(() => undefined);
  if (!state) return "次サイクルで自動継続";
  if (state.hardStopReason) return `停止中（要対応）: ${state.hardStopReason}`;
  if (state.paused) return `一時停止中${state.pausedReason ? `: ${state.pausedReason}` : ""}`;
  if (state.blockedReason) return `待ち: ${state.blockedReason}`;
  const song = state.currentSongId ? `${state.currentSongId}（${state.stage}）` : `アイドル（${state.stage}）`;
  return `進行中: ${song} — 次サイクルで自動継続`;
}

export async function composeProducerDigest(root: string, now: Date = new Date()): Promise<string> {
  const events = await readRuntimeEvents(root, Number.MAX_SAFE_INTEGER).catch(() => [] as RuntimeEvent[]);
  const counts = countRecentEvents(events, now.getTime() - DIGEST_WINDOW_MS);
  const nextLine = await composeNextLine(root);
  const lines = [
    `📋 デイリーダイジェスト（${localDateKey(now)}）`,
    "",
    "直近24hの動き:",
    `・完成したテイク: ${counts.takesCompleted} 曲`,
    `・新しい曲の提案: ${counts.newProposals} 件`,
    `・Suno 生成結果: ${counts.sunoResults} 回`,
    `・human-assist 依頼: ${counts.humanAssist} 件`,
    `・ブロッカー/要対応: ${counts.blockers} 件`,
    "",
    `次の予定: ${nextLine}`
  ];
  return lines.join("\n");
}

// Sends at most one digest per local calendar day. Returns delivered:false with a
// skip reason (mode not "daily", already sent today, or no chat) so the caller — and
// tests — can tell an intentional no-send from a real delivery.
export async function sendProducerDigestOnce(options: ProducerDigestWorkerOptions): Promise<ProducerDigestResult> {
  if (options.mode !== undefined && options.mode !== "daily") {
    return { delivered: false, skipped: "mode" };
  }
  if (options.chatIds.length === 0) {
    return { delivered: false, skipped: "no_chat" };
  }
  const now = options.now ?? new Date();
  const dateKey = localDateKey(now);
  const lastSent = await readLastSentDateKey(options.root);
  if (lastSent === dateKey) {
    return { delivered: false, skipped: "dedup", dateKey };
  }
  const text = await composeProducerDigest(options.root, now);
  const client = new TelegramClient(options.token, options.fetchImpl);
  for (const chatId of options.chatIds) {
    await client.sendMessage(chatId, text);
  }
  await writeLastSentDateKey(options.root, dateKey);
  return { delivered: true, dateKey };
}

export function startProducerDigestWorker(options: ProducerDigestWorkerOptions): () => void {
  let running = false;
  let stopped = false;
  const intervalMs = Math.max(60_000, options.intervalMs ?? DEFAULT_CHECK_INTERVAL_MS);

  const run = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const result = await sendProducerDigestOnce({ ...options, now: new Date() });
      // Log only a real send so gateway.log carries a positive delivery signal; an
      // intentional skip (dedup / mode) stays silent to avoid per-tick noise.
      if (result.delivered) {
        console.log(`[producer-digest] delivered daily digest to ${options.chatIds.length} chat(s) dateKey=${result.dateKey}`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`[producer-digest] worker failed: ${reason}`);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void run();
  }, intervalMs);
  timer.unref?.();
  void run();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
