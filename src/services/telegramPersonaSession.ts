import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AiReviewProvider, TelegramPersonaSession, TelegramPersonaSessionMode } from "../types.js";
import { resetArtistPersonaBlock } from "./personaFileBuilder.js";
import { executePersonaMigrate, planPersonaMigrate } from "./personaMigrator.js";
import { resetSoulPersonaBlock } from "./soulFileBuilder.js";

export const TELEGRAM_PERSONA_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface CreateTelegramPersonaSessionInput {
  mode: TelegramPersonaSessionMode;
  chatId: number;
  userId: number;
  aiReviewProvider?: AiReviewProvider;
  migrateIntent?: string;
  migrateAiReviewProvider?: AiReviewProvider;
  pending?: TelegramPersonaSession["pending"];
  now?: number;
  ttlMs?: number;
}

export interface UpdateTelegramPersonaSessionInput {
  mode?: TelegramPersonaSessionMode;
  aiReviewProvider?: AiReviewProvider;
  migrateIntent?: string;
  migrateAiReviewProvider?: AiReviewProvider;
  pending?: TelegramPersonaSession["pending"];
  active?: boolean;
  now?: number;
  ttlMs?: number;
}

export function telegramPersonaSessionPath(root: string): string {
  return join(root, "runtime", "telegram-persona-session.json");
}

function logTelegramPersonaSessionFailure(context: string, error: unknown): void {
  if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return;
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`[telegram-persona-session] ${context} failed: ${reason}`);
}

function isPersonaSession(value: Partial<TelegramPersonaSession>): value is TelegramPersonaSession {
  return (
    typeof value.active === "boolean" &&
    typeof value.mode === "string" &&
    typeof value.stepIndex === "number" &&
    typeof value.pending === "object" &&
    Array.isArray(value.history) &&
    typeof value.startedAt === "number" &&
    typeof value.updatedAt === "number" &&
    typeof value.chatId === "number" &&
    typeof value.userId === "number" &&
    typeof value.expiresAt === "number"
  );
}

function isExpired(session: TelegramPersonaSession, now: number): boolean {
  return session.expiresAt <= now;
}

async function writeSession(root: string, session: TelegramPersonaSession): Promise<TelegramPersonaSession> {
  const path = telegramPersonaSessionPath(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(session, null, 2)}\n`, "utf8");
  return session;
}

export async function readTelegramPersonaSession(root: string, now = Date.now()): Promise<TelegramPersonaSession | undefined> {
  const contents = await readFile(telegramPersonaSessionPath(root), "utf8").catch(() => "");
  if (!contents) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(contents) as Partial<TelegramPersonaSession>;
    if (!isPersonaSession(parsed) || !parsed.active || isExpired(parsed, now)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export async function createTelegramPersonaSession(root: string, input: CreateTelegramPersonaSessionInput): Promise<TelegramPersonaSession> {
  const now = input.now ?? Date.now();
  return writeSession(root, {
    active: true,
    mode: input.mode,
    stepIndex: 0,
    aiReviewProvider: input.aiReviewProvider,
    migrateIntent: input.migrateIntent,
    migrateAiReviewProvider: input.migrateAiReviewProvider,
    pending: input.pending ?? {},
    history: [],
    startedAt: now,
    updatedAt: now,
    chatId: input.chatId,
    userId: input.userId,
    expiresAt: now + (input.ttlMs ?? TELEGRAM_PERSONA_SESSION_TTL_MS)
  });
}

export async function updateTelegramPersonaSession(root: string, input: UpdateTelegramPersonaSessionInput): Promise<TelegramPersonaSession | undefined> {
  const now = input.now ?? Date.now();
  const current = await readTelegramPersonaSession(root, now);
  if (!current) {
    return undefined;
  }
  return writeSession(root, {
    ...current,
    active: input.active ?? current.active,
    mode: input.mode ?? current.mode,
    aiReviewProvider: input.aiReviewProvider ?? current.aiReviewProvider,
    migrateIntent: input.migrateIntent ?? current.migrateIntent,
    migrateAiReviewProvider: input.migrateAiReviewProvider ?? current.migrateAiReviewProvider,
    pending: input.pending ?? current.pending,
    updatedAt: now,
    expiresAt: now + (input.ttlMs ?? TELEGRAM_PERSONA_SESSION_TTL_MS)
  });
}

export async function cancelTelegramPersonaSession(root: string): Promise<void> {
  await unlink(telegramPersonaSessionPath(root)).catch((error) => logTelegramPersonaSessionFailure("cancel session cleanup", error));
}

export async function handleTelegramPersonaSessionMessage(root: string, text: string, now = Date.now()): Promise<string | undefined> {
  const session = await readTelegramPersonaSession(root, now);
  if (!session) {
    return undefined;
  }
  const command = text.trim().toLowerCase();
  if (command === "/cancel" || command === "/no") {
    await cancelTelegramPersonaSession(root);
    return "cancelled. No persona files were changed.";
  }
  if (session.mode === "reset_confirm") {
    if (command === "/confirm reset" || command === "/yes") {
      await resetArtistPersonaBlock(root);
      await resetSoulPersonaBlock(root);
      await cancelTelegramPersonaSession(root);
      return "Telegram-managed persona blocks were reset. Songs, ledgers, budget, and profiles were not touched.";
    }
    return "Persona reset is waiting for confirmation. Reply /confirm reset, /yes, /cancel, or /no.";
  }
  if (session.mode === "migrate_confirm") {
    if (command === "/confirm migrate" || command === "/yes") {
      const plan = await planPersonaMigrate(root, {
        intent: session.migrateIntent,
        aiReviewProvider: session.migrateAiReviewProvider
      });
      await executePersonaMigrate(root, plan);
      await cancelTelegramPersonaSession(root);
      return plan.warnings.includes("already migrated")
        ? "Persona is already migrated. No files were changed."
        : "Persona migrated into Telegram-managed marker blocks. Backup files were written first.";
    }
    return "Persona migrate is waiting for confirmation. Reply /confirm migrate, /yes, /cancel, or /no.";
  }
  await cancelTelegramPersonaSession(root);
  return "Legacy wizard sessions are no longer supported. Talk to the artist naturally, or use /persona migrate for marker conversion.";
}
