import type {
  ArtistRuntimeConfig,
  SunoCreatePayload,
  SunoCreateRequest,
  SunoCreateResult,
  SunoImportResult,
  SunoWorkerStatus
} from "../../types.js";
import {
  runHumanAssistCreate,
  HUMAN_ASSIST_TIMEOUT_REASON,
  type HumanAssistBrowserDriver,
  type HumanAssistNotifier
} from "../../services/sunoHumanAssist.js";
import { emitRuntimeEvent } from "../../services/runtimeEventBus.js";
import { CdpHumanAssistDriver } from "../../services/cdpHumanAssistDriver.js";
import type { SunoConnector } from "./SunoConnector.js";

// The CLI connector reason for a captcha-blocked create (EXIT_REASONS[31]). Only this
// reason triggers the human-assist fallback; every other failure keeps its own routing.
export const CLI_BLOCKED_CAPTCHA_REASON = "suno_cli_blocked_captcha";
export const HUMAN_ASSIST_CREATED_REASON = "suno_human_assist_created";

export interface HumanAssistDriverInput {
  payload: SunoCreatePayload;
  songId: string;
  title: string;
}

export interface HumanAssistConnectorDeps {
  timeoutMs: number;
  driverFactory: (input: HumanAssistDriverInput) => HumanAssistBrowserDriver;
  notifier: HumanAssistNotifier;
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * SunoConnector decorator that adds the opt-in captcha human-assist fallback.
 *
 * It delegates every call to the inner connector (the suno-cli connector). When a
 * live create is blocked by a captcha (CLI_BLOCKED_CAPTCHA_REASON), it runs the
 * human-assist state machine: open+fill the CDP browser, try a machine submit, and on
 * a captcha challenge close the overlay (never solve it) and hand off to the producer
 * for a manual Create click. A machine or human success is mapped back to an accepted
 * SunoCreateResult (so the normal run/import pipeline continues unchanged); a timeout
 * or error is surfaced as a non-accepted result the autopilot routes for a later retry.
 */
export class HumanAssistSunoConnector implements SunoConnector {
  constructor(
    private readonly inner: SunoConnector,
    private readonly deps: HumanAssistConnectorDeps
  ) {}

  status(): Promise<SunoWorkerStatus> {
    return this.inner.status();
  }

  importResults(input: { runId: string; urls: string[] }): Promise<SunoImportResult> {
    return this.inner.importResults(input);
  }

  async create(input: SunoCreateRequest): Promise<SunoCreateResult> {
    const result = await this.inner.create(input);
    // Only intercept a captcha block on a real (non dry-run) live create. Everything
    // else -- accepted, dry-run, or a different failure reason -- passes through.
    if (input.dryRun || result.accepted || result.reason !== CLI_BLOCKED_CAPTCHA_REASON) {
      return result;
    }

    const payload = input.payload ?? ({} as SunoCreatePayload);
    const songId = input.songId ?? result.runId;
    const title = readText(payload.songName) ?? songId;
    const driver = this.deps.driverFactory({ payload, songId, title });
    const outcome = await runHumanAssistCreate({
      driver,
      notifier: this.deps.notifier,
      songId,
      title,
      timeoutMs: this.deps.timeoutMs
    });

    if (outcome.status === "accepted") {
      return {
        accepted: true,
        runId: result.runId,
        reason: HUMAN_ASSIST_CREATED_REASON,
        urls: outcome.urls,
        pendingTakeUrl: outcome.urls.find(Boolean)
      };
    }
    if (outcome.status === "timeout") {
      return { accepted: false, runId: result.runId, reason: HUMAN_ASSIST_TIMEOUT_REASON, urls: [] };
    }
    return { accepted: false, runId: result.runId, reason: outcome.reason, urls: [] };
  }
}

/**
 * Production notifier: emits a non-silent runtime event so the Telegram notifier can
 * ask the producer to press Create on the Mac. Fires at most once per attempt.
 */
export function createHumanAssistNotifier(timeoutMinutes: number): HumanAssistNotifier {
  return {
    awaitingHumanCreate: ({ songId, title }) => {
      emitRuntimeEvent({
        type: "suno_human_assist_requested",
        songId,
        title,
        timeoutMinutes,
        timestamp: Date.now()
      });
    }
  };
}

/**
 * Wire the decorator for production: attach to CDP Chrome and alert via Telegram.
 * Kept separate from the class so tests can drive the class with stub deps.
 */
export function createHumanAssistSunoConnector(
  inner: SunoConnector,
  config?: Partial<ArtistRuntimeConfig>
): HumanAssistSunoConnector {
  const timeoutMinutes = config?.music?.suno?.humanAssistTimeoutMinutes ?? 60;
  return new HumanAssistSunoConnector(inner, {
    timeoutMs: timeoutMinutes * 60_000,
    driverFactory: ({ payload }) => new CdpHumanAssistDriver({ payload, config }),
    notifier: createHumanAssistNotifier(timeoutMinutes)
  });
}
