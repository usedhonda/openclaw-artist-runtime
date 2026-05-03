import { safeRegisterService } from "../pluginApi.js";
import type { ArtistRuntimeConfig } from "../types.js";
import { ArtistAutopilotService } from "./autopilotService.js";
import { getAutopilotTicker } from "./autopilotTicker.js";
import { getRuntimeEventBus } from "./runtimeEventBus.js";
import { isTelegramNotifierEnabled, resolveDefaultWorkspaceRoot, resolveRuntimeConfig } from "./runtimeConfig.js";
import { SocialDistributionWorker } from "./socialDistributionWorker.js";
import { SunoBrowserWorker } from "./sunoBrowserWorker.js";
import { getTelegramOwnerUserIds } from "./telegramAuth.js";
import { TelegramNotifier } from "./telegramNotifier.js";

let telegramNotifierUnsubscribers: Array<() => void> = [];

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
  telegramNotifierUnsubscribers = ownerIds.map((chatId) => new TelegramNotifier({
    token,
    chatId: Number.isFinite(Number(chatId)) ? Number(chatId) : chatId,
    workspaceRoot: config.artist.workspaceRoot,
    aiReviewProvider: config.aiReview.provider
  }).subscribe(getRuntimeEventBus()));
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
}
