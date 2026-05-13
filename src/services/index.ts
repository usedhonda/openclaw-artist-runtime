import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { safeRegisterService } from "../pluginApi.js";
import type { ArtistRuntimeConfig } from "../types.js";
import { ArtistAutopilotService } from "./autopilotService.js";
import { getAutopilotTicker } from "./autopilotTicker.js";
import { startCallbackPollingWatchdog } from "./callbackPollingWatchdog.js";
import { getRuntimeEventBus } from "./runtimeEventBus.js";
import { isTelegramNotifierEnabled, resolveDefaultWorkspaceRoot, resolveRuntimeConfig } from "./runtimeConfig.js";
import { SocialDistributionWorker } from "./socialDistributionWorker.js";
import { SunoBrowserWorker } from "./sunoBrowserWorker.js";
import { getTelegramOwnerUserIds } from "./telegramAuth.js";
import { TelegramNotifier } from "./telegramNotifier.js";

let telegramNotifierUnsubscribers: Array<() => void> = [];
let stopCallbackWatchdog: (() => void) | null = null;

const SILENCE_RECOVERY_WINDOW_MS = 10 * 60 * 1000;
const SILENCE_RECOVERY_DELAY_MS = 8000;
const SILENCE_RECOVERY_MESSAGE =
  "御大、 さっき Telegram の通信が詰まって沈黙してた。 もし button 押してたら反応なかったはず。 今復活したから、 もう一回押してくれる？";

export async function readSilenceFlag(workspaceRoot: string): Promise<{ path: string; firedAtMs: number } | null> {
  const path = join(workspaceRoot, "runtime", "telegram-watchdog-fired-at.txt");
  try {
    const raw = await readFile(path, "utf8");
    const parsed = Number.parseInt(raw.trim(), 10);
    if (!Number.isFinite(parsed)) return null;
    return { path, firedAtMs: parsed * 1000 };
  } catch {
    return null;
  }
}

export async function maybeSendSilenceRecoveryNotice(
  token: string,
  chatIds: ReadonlyArray<string | number>,
  workspaceRoot: string
): Promise<void> {
  const flag = await readSilenceFlag(workspaceRoot);
  if (!flag) return;
  const ageMs = Date.now() - flag.firedAtMs;
  if (ageMs < 0 || ageMs > SILENCE_RECOVERY_WINDOW_MS) {
    await unlink(flag.path).catch(() => undefined);
    return;
  }
  let allDelivered = true;
  for (const chatId of chatIds) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: SILENCE_RECOVERY_MESSAGE })
      });
      if (!response.ok) allDelivered = false;
    } catch {
      allDelivered = false;
    }
  }
  if (allDelivered) {
    await unlink(flag.path).catch(() => undefined);
  }
}

export async function startTelegramNotifierFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<{ started: number; reason?: string }> {
  if (!isTelegramNotifierEnabled(env)) {
    return { started: 0, reason: "disabled_by_flag" };
  }
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const ownerIds = [...getTelegramOwnerUserIds(env)];
  if (!token || ownerIds.length === 0) {
    console.warn("[artist-runtime] telegram notifier disabled: token/chatId missing");
    return { started: 0, reason: "missing_token_or_chat_id" };
  }
  if (telegramNotifierUnsubscribers.length > 0) {
    return { started: telegramNotifierUnsubscribers.length, reason: "already_started" };
  }
  const workspaceRoot = env.OPENCLAW_LOCAL_WORKSPACE?.trim() || resolveDefaultWorkspaceRoot();
  const config = await resolveRuntimeConfig({ artist: { workspaceRoot } } as Partial<ArtistRuntimeConfig>, workspaceRoot);
  const dashboardBaseUrl = env.OPENCLAW_DASHBOARD_BASE_URL?.trim() || undefined;
  telegramNotifierUnsubscribers = ownerIds.map((chatId) => new TelegramNotifier({
    token,
    chatId: Number.isFinite(Number(chatId)) ? Number(chatId) : chatId,
    workspaceRoot: config.artist.workspaceRoot,
    aiReviewProvider: config.aiReview.provider,
    dashboardBaseUrl
  }).subscribe(getRuntimeEventBus()));
  setTimeout(() => {
    void maybeSendSilenceRecoveryNotice(token, ownerIds, config.artist.workspaceRoot);
  }, SILENCE_RECOVERY_DELAY_MS).unref();
  return { started: telegramNotifierUnsubscribers.length };
}

export function stopTelegramNotifierSubscriptions(): void {
  for (const unsubscribe of telegramNotifierUnsubscribers) {
    unsubscribe();
  }
  telegramNotifierUnsubscribers = [];
}

export function registerServices(api: unknown): void {
  safeRegisterService(api, {
    name: "artistAutopilotService",
    create: () => new ArtistAutopilotService()
  });

  safeRegisterService(api, {
    name: "sunoBrowserWorker",
    create: () => new SunoBrowserWorker(resolveDefaultWorkspaceRoot())
  });

  safeRegisterService(api, {
    name: "socialDistributionWorker",
    create: () => new SocialDistributionWorker()
  });

  safeRegisterService(api, {
    name: "autopilotTicker",
    create: () => getAutopilotTicker()
  });

  safeRegisterService(api, {
    name: "telegramNotifier",
    create: () => ({
      start: () => startTelegramNotifierFromEnv(),
      stop: () => {
        stopTelegramNotifierSubscriptions();
      }
    })
  });

  safeRegisterService(api, {
    name: "callbackPollingWatchdog",
    create: () => ({
      start: () => {
        if (!stopCallbackWatchdog) {
          stopCallbackWatchdog = startCallbackPollingWatchdog();
        }
        return { started: 1 };
      },
      stop: () => {
        stopCallbackWatchdog?.();
        stopCallbackWatchdog = null;
      }
    })
  });
}
