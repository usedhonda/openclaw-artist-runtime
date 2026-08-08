import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RuntimeEvent } from "./runtimeEventBus.js";

export interface TelegramDeliveryReceipt {
  deliveryId: string;
  eventType: RuntimeEvent["type"];
  songId?: string;
  messageId: number;
  eventTimestamp: number;
  deliveredAt: string;
}

export function telegramDeliveryLedgerPath(root: string): string {
  return join(root, "runtime", "telegram-deliveries.jsonl");
}

function eventSongId(event: RuntimeEvent): string | undefined {
  if ("songId" in event && typeof event.songId === "string") return event.songId;
  if ("candidateSongId" in event && typeof event.candidateSongId === "string") return event.candidateSongId;
  return undefined;
}

export async function appendTelegramDeliveryReceipt(
  root: string,
  event: RuntimeEvent,
  messageId: number,
  now = new Date()
): Promise<TelegramDeliveryReceipt> {
  const songId = eventSongId(event);
  const receipt: TelegramDeliveryReceipt = {
    deliveryId: createHash("sha256")
      .update(JSON.stringify({ eventType: event.type, songId, messageId, eventTimestamp: event.timestamp }))
      .digest("hex")
      .slice(0, 16),
    eventType: event.type,
    ...(songId ? { songId } : {}),
    messageId,
    eventTimestamp: event.timestamp,
    deliveredAt: now.toISOString()
  };
  const path = telegramDeliveryLedgerPath(root);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(receipt)}\n`, "utf8");
  return receipt;
}

export async function readTelegramDeliveryReceipts(root: string): Promise<TelegramDeliveryReceipt[]> {
  const contents = await readFile(telegramDeliveryLedgerPath(root), "utf8").catch(() => "");
  return contents
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TelegramDeliveryReceipt);
}
