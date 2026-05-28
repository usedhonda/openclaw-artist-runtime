import { appendFile, mkdir, readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import type { CommissionBrief } from "../types.js";

export type CallbackActionStatus =
  | "pending"
  | "applied"
  | "discarded"
  | "updated"
  | "duplicate"
  | "expired"
  | "unauthorized"
  | "failed";

export interface CallbackActionEntry {
  callbackId: string;
  action: string;
  proposalId?: string;
  songId?: string;
  platform?: string;
  draftText?: string;
  draftHash?: string;
  draftCharCount?: number;
  draftUrl?: string;
  tweetUrl?: string;
  selectedTakeId?: string;
  commissionBrief?: CommissionBrief;
  spawnReason?: string;
  chatId: number;
  messageId: number;
  userId: number;
  createdAt: number;
  expiresAt: number;
  status: CallbackActionStatus;
  resolvedAt?: number;
  resolveReason?: string;
  reminderSentAt?: number;
  reminderReason?: string;
}

export type PromptPackGoAction = CallbackActionEntry & { action: "prompt_pack_go"; songId: string };
export type PromptPackEditAction = CallbackActionEntry & { action: "prompt_pack_edit"; songId: string };
export type PromptPackSkipAction = CallbackActionEntry & { action: "prompt_pack_skip"; songId: string };

export interface RegisterCallbackActionInput {
  action: string;
  proposalId?: string;
  songId?: string;
  platform?: string;
  draftText?: string;
  draftHash?: string;
  draftCharCount?: number;
  draftUrl?: string;
  tweetUrl?: string;
  selectedTakeId?: string;
  commissionBrief?: CommissionBrief;
  spawnReason?: string;
  chatId: number;
  messageId: number;
  userId: number;
  now?: number;
  expiresAt?: number;
}

export interface MarkCallbackResolvedInput {
  status: Exclude<CallbackActionStatus, "pending">;
  reason?: string;
  now?: number;
}

export interface MarkCallbackRepromptedInput {
  now?: number;
  actor?: "watchdog_reprompt" | "watchdog_expire";
  reason?: string;
}

export interface CallbackActionEffect {
  action: string;
  label: string;
  effect: string;
}

export interface PendingCallbackSummary {
  count: number;
  recent: Array<{
    callbackId: string;
    action: string;
    category: TtlCategory;
    label: string;
    effect: string;
    songId?: string;
    proposalId?: string;
    platform?: string;
    createdAt: number;
    expiresAt: number;
    reminderSentAt?: number;
  }>;
}

const TTL_CATEGORY = {
  producer_decision: 30 * 24 * 60 * 60 * 1000,
  working_confirmation: 24 * 60 * 60 * 1000
} as const;

export type TtlCategory = keyof typeof TTL_CATEGORY;

const CALLBACK_ACTION_CATEGORY: Record<string, TtlCategory> = {
  song_archive: "producer_decision",
  song_discard: "producer_decision",
  song_spawn_inject: "producer_decision",
  song_spawn_skip: "producer_decision",
  song_spawn_edit: "producer_decision"
};

export function callbackActionTtlCategory(action?: string): TtlCategory {
  if (!action) return "working_confirmation";
  return CALLBACK_ACTION_CATEGORY[action] ?? "working_confirmation";
}

export function isProducerDecisionAction(action?: string): boolean {
  return callbackActionTtlCategory(action) === "producer_decision";
}

const callbackActionEffects: Record<string, Omit<CallbackActionEffect, "action">> = {
  proposal_yes: { label: "反映", effect: "提案された変更を workspace に反映します。" },
  proposal_no: { label: "保留", effect: "提案を見送り、現状を変えません。" },
  proposal_edit_open: { label: "編集", effect: "編集指示を受け付ける状態にします。" },
  dist_apply: { label: "配信記録に反映", effect: "検出した配信 URL を song state / ledger に反映します。" },
  dist_skip: { label: "保留", effect: "配信 URL の反映を見送ります。" },
  song_songbook_write: { label: "SONGBOOK.md に追記", effect: "完成曲を SONGBOOK.md に記録します。" },
  song_skip: { label: "保留", effect: "完成曲の反映を今回は見送ります。" },
  song_archive: { label: "採用して次の曲へ", effect: "この曲を採用し、次の曲作りへ進める (autopilot 再開待ち)。SNS には出さない。" },
  song_discard: { label: "破棄して次の曲へ", effect: "この曲を破棄し、次の曲作りへ進める (autopilot 再開待ち)。brief は reuse のため残す。" },
  daily_voice_publish: { label: "投稿", effect: "草案を X に投稿します。外部公開が発生します。" },
  daily_voice_edit: { label: "編集", effect: "草案を直すための返信待ちにします。" },
  daily_voice_cancel: { label: "キャンセル", effect: "草案投稿を破棄します。" },
  song_spawn_inject: { label: "進める", effect: "この着想で曲を作る。" },
  song_spawn_skip: { label: "保留する", effect: "この着想を保留する。" },
  song_spawn_edit: { label: "修正する", effect: "この commission を編集する。" },
  prompt_pack_go: { label: "Suno 生成へ", effect: "prompt_pack の停止を解除し、次 cycle で Suno 生成へ進めます。" },
  prompt_pack_edit: { label: "lyrics-suno.md を編集", effect: "planning に戻し、歌詞をもう一度作り直します。" },
  prompt_pack_skip: { label: "保留", effect: "この曲を user_paused にして後で再開できる状態にします。" },
  planning_skeleton_apply: { label: "進める", effect: "補完案を反映し、prompt_pack へ進めます。" },
  planning_skeleton_skip: { label: "中止", effect: "補完案を見送り、今の planning 停止を解除します。" },
  planning_skeleton_edit: { label: "書き直す", effect: "補完案を直すための編集指示待ちにします。" },
  take_select_accept: { label: "採用", effect: "低スコアでも現在の best take を採用します。" },
  take_select_regenerate: { label: "再生成", effect: "take を採用せず、Suno 生成をもう一度走らせる準備をします。" },
  take_select_skip: { label: "保留", effect: "take 選別を今回は見送ります。" },
  x_publish_prepare: { label: "X 草案を作る", effect: "投稿はせず、X 投稿の確認用草案を作ります。" },
  x_publish_confirm: { label: "Xに投稿", effect: "確認済み草案を X に投稿します。外部公開が発生します。" },
  x_publish_cancel: { label: "やめる", effect: "X 投稿草案を破棄します。" }
};

export function describeCallbackActionEffect(action: string): CallbackActionEffect {
  const known = callbackActionEffects[action];
  if (known) {
    return { action, ...known };
  }
  return {
    action,
    label: action,
    effect: "未分類の callback です。押す前に Producer Console / audit を確認してください。"
  };
}

export function callbackActionLedgerPath(root: string): string {
  return join(root, "runtime", "callback-actions.jsonl");
}

function callbackAuditPath(root: string): string {
  return join(root, "runtime", "callback-audit.jsonl");
}

export function defaultCallbackActionExpiresAt(now = Date.now(), action?: string): number {
  return now + TTL_CATEGORY[callbackActionTtlCategory(action)];
}

function shortCallbackId(): string {
  return randomBytes(7).toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, 10);
}

async function appendEntry(root: string, entry: CallbackActionEntry): Promise<CallbackActionEntry> {
  const path = callbackActionLedgerPath(root);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

export async function readCallbackActionEntries(root: string): Promise<CallbackActionEntry[]> {
  const contents = await readFile(callbackActionLedgerPath(root), "utf8").catch(() => "");
  return contents
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CallbackActionEntry);
}

function latestCallbackActionEntries(entries: CallbackActionEntry[]): CallbackActionEntry[] {
  const latest = new Map<string, CallbackActionEntry>();
  for (const entry of entries) {
    latest.set(entry.callbackId, entry);
  }
  return [...latest.values()];
}

export async function summarizePendingCallbackActions(root: string, limit = 6, now = Date.now()): Promise<PendingCallbackSummary> {
  return listPendingCallbackActionSummaries(root, { limit, now });
}

export async function listPendingCallbackActionSummaries(
  root: string,
  options: { limit?: number; now?: number; category?: TtlCategory } = {}
): Promise<PendingCallbackSummary> {
  const now = options.now ?? Date.now();
  const limit = options.limit ?? 6;
  const pending = latestCallbackActionEntries(await readCallbackActionEntries(root))
    .filter((entry) => entry.status === "pending" && entry.expiresAt > now)
    .filter((entry) => !options.category || callbackActionTtlCategory(entry.action) === options.category)
    .sort((left, right) => right.createdAt - left.createdAt);
  return {
    count: pending.length,
    recent: pending.slice(0, limit).map((entry) => {
      const effect = describeCallbackActionEffect(entry.action);
      return {
        callbackId: entry.callbackId,
        action: entry.action,
        category: callbackActionTtlCategory(entry.action),
        label: effect.label,
        effect: effect.effect,
        songId: entry.songId,
        proposalId: entry.proposalId,
        platform: entry.platform,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
        reminderSentAt: entry.reminderSentAt
      };
    })
  };
}

export async function resolveCallbackAction(root: string, callbackId: string): Promise<CallbackActionEntry | undefined> {
  const entries = await readCallbackActionEntries(root);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index].callbackId === callbackId) {
      return entries[index];
    }
  }
  return undefined;
}

export async function registerCallbackAction(root: string, input: RegisterCallbackActionInput): Promise<CallbackActionEntry> {
  const now = input.now ?? Date.now();
  let callbackId = shortCallbackId();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (!await resolveCallbackAction(root, callbackId)) {
      break;
    }
    callbackId = shortCallbackId();
  }
  if (await resolveCallbackAction(root, callbackId)) {
    throw new Error("callback_action_id_collision");
  }
  return appendEntry(root, {
    callbackId,
    action: input.action,
    proposalId: input.proposalId,
    songId: input.songId,
    platform: input.platform,
    draftText: input.draftText,
    draftHash: input.draftHash,
    draftCharCount: input.draftCharCount,
    draftUrl: input.draftUrl,
    tweetUrl: input.tweetUrl,
    selectedTakeId: input.selectedTakeId,
    commissionBrief: input.commissionBrief,
    spawnReason: input.spawnReason,
    chatId: input.chatId,
    messageId: input.messageId,
    userId: input.userId,
    createdAt: now,
    expiresAt: input.expiresAt ?? defaultCallbackActionExpiresAt(now, input.action),
    status: "pending"
  });
}

export async function markCallbackResolved(root: string, callbackId: string, input: MarkCallbackResolvedInput): Promise<CallbackActionEntry | undefined> {
  const current = await resolveCallbackAction(root, callbackId);
  if (!current) {
    return undefined;
  }
  return appendEntry(root, {
    ...current,
    status: input.status,
    resolvedAt: input.now ?? Date.now(),
    resolveReason: input.reason
  });
}

async function appendCallbackAuditMarker(
  root: string,
  entry: CallbackActionEntry,
  input: Required<MarkCallbackRepromptedInput>
): Promise<void> {
  const path = callbackAuditPath(root);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify({
    timestamp: input.now,
    callbackId: entry.callbackId,
    action: entry.action,
    proposalId: entry.proposalId,
    songId: entry.songId,
    platform: entry.platform,
    result: input.actor === "watchdog_expire" ? "expired" : "reprompted",
    reason: input.reason,
    actor: input.actor
  })}\n`, "utf8");
}

export async function markCallbackReprompted(
  root: string,
  callbackId: string,
  input: MarkCallbackRepromptedInput = {}
): Promise<CallbackActionEntry | undefined> {
  const current = await resolveCallbackAction(root, callbackId);
  if (!current) {
    return undefined;
  }
  await appendCallbackAuditMarker(root, current, {
    now: input.now ?? Date.now(),
    actor: input.actor ?? "watchdog_reprompt",
    reason: input.reason ?? "polling_watchdog_reprompt"
  });
  return current;
}

export async function markCallbackReminderSent(
  root: string,
  callbackId: string,
  input: { now?: number; reason?: string } = {}
): Promise<CallbackActionEntry | undefined> {
  const current = await resolveCallbackAction(root, callbackId);
  if (!current) {
    return undefined;
  }
  const now = input.now ?? Date.now();
  await appendCallbackAuditEvent(root, {
    timestamp: now,
    callbackId: current.callbackId,
    action: current.action,
    songId: current.songId,
    result: "reminded",
    reason: input.reason ?? "producer_decision_reminder",
    actor: "producer_reminder"
  });
  return appendEntry(root, {
    ...current,
    reminderSentAt: now,
    reminderReason: input.reason ?? "producer_decision_reminder"
  });
}

export async function appendCallbackAuditEvent(
  root: string,
  entry: {
    timestamp?: number;
    callbackId?: string;
    action?: string;
    songId?: string;
    result: string;
    reason: string;
    actor: string;
  }
): Promise<void> {
  const path = callbackAuditPath(root);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify({
    timestamp: entry.timestamp ?? Date.now(),
    callbackId: entry.callbackId,
    action: entry.action,
    songId: entry.songId,
    result: entry.result,
    reason: entry.reason,
    actor: entry.actor
  })}\n`, "utf8");
}

export async function hasCallbackReprompted(root: string, callbackId: string): Promise<boolean> {
  const contents = await readFile(callbackAuditPath(root), "utf8").catch(() => "");
  return contents
    .split("\n")
    .filter(Boolean)
    .some((line) => {
      try {
        const entry = JSON.parse(line) as { callbackId?: string; reason?: string };
        return entry.callbackId === callbackId && entry.reason === "polling_watchdog_reprompt";
      } catch {
        return false;
      }
    });
}
