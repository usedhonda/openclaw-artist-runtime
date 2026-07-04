import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { safeRegisterService } from "../pluginApi.js";
import type { ArtistRuntimeConfig } from "../types.js";
import { ArtistAutopilotService } from "./autopilotService.js";
import { getAutopilotTicker } from "./autopilotTicker.js";
import { startCallbackPollingWatchdog } from "./callbackPollingWatchdog.js";
import { getRuntimeEventBus } from "./runtimeEventBus.js";
import { appendRuntimeEvent } from "./runtimeEventsLedger.js";
import { getDashboardBaseUrl, isTelegramNotifierEnabled, resolveDefaultWorkspaceRoot, resolveRuntimeConfig } from "./runtimeConfig.js";
import { SocialDistributionWorker } from "./socialDistributionWorker.js";
import { CliSunoConnector } from "../connectors/suno/cliSunoConnector.js";
import { SunoBrowserWorker } from "./sunoBrowserWorker.js";
import { startFailedNotifyReplayWorker } from "./failedNotifyReplayWorker.js";
import { rearmQueuedAdoptionDownloadJobs } from "./sunoAdoptionDownloadJob.js";
import { getTelegramOwnerUserIds } from "./telegramAuth.js";
import { TelegramNotifier } from "./telegramNotifier.js";

let telegramNotifierUnsubscribers: Array<() => void> = [];
let runtimeEventLedgerUnsubscriber: (() => void) | null = null;
let stopCallbackWatchdog: (() => void) | null = null;
let stopAutopilotTicker: (() => void) | null = null;
let stopFailedNotifyReplayWorker: (() => void) | null = null;
let resolvedConfigCache: ArtistRuntimeConfig | null = null;

const SILENCE_RECOVERY_WINDOW_MS = 10 * 60 * 1000;
const SILENCE_RECOVERY_DELAY_MS = 8000;
const SILENCE_RECOVERY_MESSAGE =
  "御大、 さっき Telegram の通信が詰まって沈黙してた。 もし button 押してたら反応なかったはず。 今復活したから、 もう一回押してくれる？";

function logSideEffectFailure(context: string, error: unknown): void {
  if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return;
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`[artist-runtime] ${context} failed: ${reason}`);
}

function failedNotifyReplayEnabled(env: NodeJS.ProcessEnv): boolean {
  const value = env.OPENCLAW_FAILED_NOTIFY_REPLAY_ENABLED?.trim().toLowerCase();
  return value !== "0" && value !== "off" && value !== "false";
}

function positiveIntegerFromEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const parsed = Number.parseInt(env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveHoursFromEnvMs(env: NodeJS.ProcessEnv, name: string, fallbackHours: number): number {
  const parsed = Number.parseFloat(env[name] ?? "");
  const hours = Number.isFinite(parsed) && parsed >= 0 ? parsed : fallbackHours;
  return Math.round(hours * 60 * 60 * 1000);
}

function adoptionDownloadClient(token: string): { sendMessage(chatId: number, text: string): Promise<unknown> } {
  return {
    async sendMessage(chatId, text) {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text })
      });
      if (!response.ok) {
        throw new Error(`telegram_send_failed:${response.status}`);
      }
      return response.json();
    }
  };
}

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
    await unlink(flag.path).catch((error) => logSideEffectFailure("silence recovery stale flag cleanup", error));
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
    } catch (error) {
      logSideEffectFailure("silence recovery notice delivery", error);
      allDelivered = false;
    }
  }
  if (allDelivered) {
    await unlink(flag.path).catch((error) => logSideEffectFailure("silence recovery delivered flag cleanup", error));
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
  const dashboardBaseUrl = getDashboardBaseUrl(config, env);
  telegramNotifierUnsubscribers = ownerIds.map((chatId) => new TelegramNotifier({
    token,
    chatId: Number.isFinite(Number(chatId)) ? Number(chatId) : chatId,
    workspaceRoot: config.artist.workspaceRoot,
    aiReviewProvider: config.aiReview.provider,
    dashboardBaseUrl,
    notifyStages: config.telegram.notifyStages,
    producerDigest: config.autopilot.producerDigest
  }).subscribe(getRuntimeEventBus()));
  if (!stopFailedNotifyReplayWorker && failedNotifyReplayEnabled(env)) {
    stopFailedNotifyReplayWorker = startFailedNotifyReplayWorker({
      root: config.artist.workspaceRoot,
      token,
      aiReviewProvider: config.aiReview.provider,
      dashboardBaseUrl,
      intervalMs: positiveIntegerFromEnv(env, "OPENCLAW_FAILED_NOTIFY_REPLAY_INTERVAL_MS", 60_000),
      maxAgeMs: positiveHoursFromEnvMs(env, "OPENCLAW_FAILED_NOTIFY_REPLAY_MAX_AGE_HOURS", 6)
    });
  }
  const primaryChatId = Number(ownerIds[0]);
  void rearmQueuedAdoptionDownloadJobs({
    root: config.artist.workspaceRoot,
    chatId: Number.isFinite(primaryChatId) ? primaryChatId : undefined,
    client: Number.isFinite(primaryChatId) ? adoptionDownloadClient(token) : undefined,
    config
  }).catch((error) => logSideEffectFailure("adoption download job rearm", error));
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
  stopFailedNotifyReplayWorker?.();
  stopFailedNotifyReplayWorker = null;
}

export function startRuntimeEventLedgerFromEnv(env: NodeJS.ProcessEnv = process.env): { started: number; reason?: string } {
  if (runtimeEventLedgerUnsubscriber) {
    return { started: 0, reason: "already_started" };
  }
  const workspaceRoot = env.OPENCLAW_LOCAL_WORKSPACE?.trim() || resolveDefaultWorkspaceRoot();
  runtimeEventLedgerUnsubscriber = getRuntimeEventBus().subscribe((event) => {
    void appendRuntimeEvent(workspaceRoot, event).catch((error) => {
      console.warn("[artist-runtime] runtime event ledger append failed", error);
    });
  });
  return { started: 1 };
}

export function stopRuntimeEventLedgerSubscription(): void {
  runtimeEventLedgerUnsubscriber?.();
  runtimeEventLedgerUnsubscriber = null;
}

export function registerServices(api: unknown): void {
  safeRegisterService(api, {
    name: "artistAutopilotService",
    create: () => new ArtistAutopilotService()
  });

  safeRegisterService(api, {
    name: "sunoBrowserWorker",
    // Boot must NOT auto-probe. SunoBrowserWorker.start() launches a headless:false
    // Chromium on every gateway boot to detect Suno login (operator-visible "flash").
    // Under profile-lock contention (a second launch on the locked profile opens an
    // empty profile that redirects to sign-in) or a transient network timeout, that
    // probe wrote login_required/disconnected over a known-good connected state — the
    // false negative 御大 observed ("logged-in screen judged as not logged in"), and a
    // gateway crash loop turned it into repeated flashes. Connection is established by
    // the explicit operator login flow (scripts/openclaw-suno-login.mjs + POST
    // .../suno/handoff/complete) and trusted thereafter; a real create() attempt
    // surfaces a genuine sign-in wall via its own failure capture. So boot only reads
    // the persisted last-known-good state — no browser launch.
    //
    // Shutdown must NOT write "stopped"/disconnected either. worker.stop() marks the
    // worker stopped+disconnected, which on the next boot (read-only, no probe) leaves
    // it permanently disconnected across a routine gateway restart — the worker would
    // lose its connected session every bounce. A gateway restart is not an operator
    // "stop the worker"; the persisted connection must survive it (any open browser is
    // a child of the gateway process and dies with it). So shutdown is a no-op; only
    // explicit operator actions (connect/reconnect/handoff) change connection state.
    create: () => {
      return {
        // Driver-aware, still read-only. When driver=suno_cli, probe via the CLI
        // connector (env read, no browser). Otherwise keep the historical
        // no-config SunoBrowserWorker construction: passing config would flip
        // shouldCheckProfileLifecycle() on for playwright and re-introduce the
        // profile probe this boot path deliberately avoids. The gate is inlined
        // here (not via resolveSunoConnector) precisely to preserve that
        // no-config, no-probe construction. Config failure falls back to the
        // browser worker (default).
        start: async () => {
          const config = await resolveRuntimeConfig().catch(() => undefined);
          if (config?.music?.suno?.driver === "suno_cli") {
            return new CliSunoConnector(resolveDefaultWorkspaceRoot()).status();
          }
          return new SunoBrowserWorker(resolveDefaultWorkspaceRoot()).status();
        },
        stop: () => undefined
      };
    }
  });

  safeRegisterService(api, {
    name: "socialDistributionWorker",
    create: () => new SocialDistributionWorker()
  });

  safeRegisterService(api, {
    name: "autopilotTicker",
    create: () => ({
      start: async () => {
        if (stopAutopilotTicker) {
          return { started: 0, reason: "already_started" };
        }
        resolvedConfigCache = await resolveRuntimeConfig();
        const ticker = getAutopilotTicker({ getConfig: () => resolvedConfigCache ?? undefined });
        ticker.start();
        stopAutopilotTicker = () => ticker.stop();
        return { started: 1 };
      },
      stop: () => {
        stopAutopilotTicker?.();
        stopAutopilotTicker = null;
        resolvedConfigCache = null;
      }
    })
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
    name: "runtimeEventLedger",
    create: () => ({
      start: () => startRuntimeEventLedgerFromEnv(),
      stop: () => {
        stopRuntimeEventLedgerSubscription();
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
