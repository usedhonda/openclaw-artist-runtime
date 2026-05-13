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

const defaultTtlMs = 24 * 60 * 60 * 1000;

export function callbackActionLedgerPath(root: string): string {
  return join(root, "runtime", "callback-actions.jsonl");
}

function callbackAuditPath(root: string): string {
  return join(root, "runtime", "callback-audit.jsonl");
}

export function defaultCallbackActionExpiresAt(now = Date.now()): number {
  return now + defaultTtlMs;
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
    expiresAt: input.expiresAt ?? defaultCallbackActionExpiresAt(now),
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
