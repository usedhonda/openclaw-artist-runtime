import { join } from "node:path";
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
import { findTakeAttributionCollisions } from "../../services/takeAttributionGuard.js";
import type { SunoBrowserConfigView } from "../../services/runtimeConfig.js";
import type { SunoConnector } from "./SunoConnector.js";

// The CLI connector reason for a captcha-blocked create (EXIT_REASONS[31]). Only this
// reason triggers the human-assist fallback; every other failure keeps its own routing.
export const CLI_BLOCKED_CAPTCHA_REASON = "suno_cli_blocked_captcha";
export const HUMAN_ASSIST_CREATED_REASON = "suno_human_assist_created";
// Every harvested take URL was already attributed to another song — a DOM harvest
// cross-card mis-map, not a real create. Surfaced as a non-accepted (retry-able) reason.
export const HUMAN_ASSIST_CROSS_SONG_REJECTED_REASON = "suno_human_assist_cross_song_rejected";

export interface HumanAssistDriverInput {
  payload: SunoCreatePayload;
  songId: string;
  title: string;
}

export interface HumanAssistConnectorDeps {
  timeoutMs: number;
  submitMode?: "skip" | "manual" | "live";
  driverFactory: (input: HumanAssistDriverInput) => HumanAssistBrowserDriver;
  notifier: HumanAssistNotifier;
  // Given the harvested take URLs, return only those NOT already attributed to another
  // song. When omitted, all harvested URLs pass through (used by tests without workspace
  // state). The production wiring backs this with findTakeAttributionCollisions so a
  // cross-song DOM leak never becomes an accepted run.
  filterCrossSongTakeUrls?: (songId: string, urls: string[]) => Promise<string[]>;
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
 * Explicit manual mode bypasses the CLI create and every machine click, opens/fills
 * the form, then waits for the producer's adjusted manual submission.
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
    const manualSubmit = this.deps.submitMode === "manual";
    const result = manualSubmit && !input.dryRun
      ? {
          accepted: false,
          runId: input.runId ?? `manual_${Date.now().toString(36)}`,
          reason: "suno_manual_submit_requested",
          urls: []
        }
      : await this.inner.create(input);
    // Only intercept a captcha block on a real (non dry-run) live create. Everything
    // else -- accepted, dry-run, or a different failure reason -- passes through.
    if (input.dryRun || result.accepted || (!manualSubmit && result.reason !== CLI_BLOCKED_CAPTCHA_REASON)) {
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
      timeoutMs: this.deps.timeoutMs,
      manualSubmit
    });

    if (outcome.status === "accepted") {
      const harvested = outcome.urls ?? [];
      const cleanUrls = this.deps.filterCrossSongTakeUrls
        ? await this.deps.filterCrossSongTakeUrls(songId, harvested)
        : harvested;
      // A DOM harvest can title-scope to the created song yet walk to a neighbouring
      // card's thumbnail, yielding another song's take id (2026-07-28 spawn_cc1049
      // grabbed Crossing Selloff's take 81132230). If EVERY harvested URL belongs to
      // another song, this was not a real create: reject as non-accepted so no
      // misattributed run is recorded and the downstream attribution guard never has to
      // hard-stop the lane — the autopilot retries for a genuine take.
      if (harvested.length > 0 && cleanUrls.length === 0) {
        emitRuntimeEvent({
          type: "error",
          source: "suno_human_assist",
          reason: `cross_song_take_rejected: ${harvested.join(", ")}`,
          songId,
          timestamp: Date.now()
        });
        return { accepted: false, runId: result.runId, reason: HUMAN_ASSIST_CROSS_SONG_REJECTED_REASON, urls: [] };
      }
      return {
        accepted: true,
        runId: result.runId,
        reason: HUMAN_ASSIST_CREATED_REASON,
        urls: cleanUrls,
        pendingTakeUrl: cleanUrls.find(Boolean)
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
export function createHumanAssistNotifier(
  timeoutMinutes: number,
  mode: "captcha_fallback" | "manual_submit" = "captcha_fallback"
): HumanAssistNotifier {
  return {
    awaitingHumanCreate: ({ songId, title }) => {
      emitRuntimeEvent({
        type: "suno_human_assist_requested",
        songId,
        title,
        timeoutMinutes,
        mode,
        timestamp: Date.now()
      });
    }
  };
}

/**
 * The CLI login command persists its authenticated Chromium profile inside the CLI
 * data directory. Human assist must reuse that profile by default; opening the
 * separate browser-worker profile makes a successful CLI login invisible to the
 * fallback and turns a captcha block into a misleading DOM-missing error.
 */
export function resolveHumanAssistBrowserConfig(
  config: SunoBrowserConfigView | undefined,
  workspaceRoot: string | undefined
): SunoBrowserConfigView | undefined {
  const browser = config?.music?.suno?.browser;
  if (!workspaceRoot || browser?.profileDir || browser?.cdpEndpoint) {
    return config;
  }
  return {
    ...config,
    music: {
      ...config?.music,
      suno: {
        ...config?.music?.suno,
        browser: {
          ...browser,
          profileDir: join(workspaceRoot, "runtime", "suno", "cli", "browser-profile")
        }
      }
    }
  };
}

/**
 * Wire the decorator for production: attach to CDP Chrome and alert via Telegram.
 * Kept separate from the class so tests can drive the class with stub deps.
 */
export function createHumanAssistSunoConnector(
  inner: SunoConnector,
  config?: Partial<ArtistRuntimeConfig>,
  workspaceRootOverride?: string
): HumanAssistSunoConnector {
  const timeoutMinutes = config?.music?.suno?.humanAssistTimeoutMinutes ?? 0;
  const workspaceRoot = workspaceRootOverride ?? config?.artist?.workspaceRoot;
  const browserConfig = resolveHumanAssistBrowserConfig(config, workspaceRoot);
  // The suno-cli session.json (Clerk cookie -> JWT) lives under the workspace runtime dir
  // and authenticates the network-primary feed harvest. Omitted when no workspace root is
  // known, in which case the driver stays DOM-only.
  const sessionFile = workspaceRoot ? join(workspaceRoot, "runtime", "suno", "cli", "session.json") : undefined;
  return new HumanAssistSunoConnector(inner, {
    // 0 is the "no time limit" sentinel: wait indefinitely for the manual Create click.
    timeoutMs: timeoutMinutes === 0 ? Infinity : timeoutMinutes * 60_000,
    submitMode: config?.music?.suno?.submitMode,
    driverFactory: ({ payload }) => new CdpHumanAssistDriver({ payload, config: browserConfig, sessionFile }),
    notifier: createHumanAssistNotifier(
      timeoutMinutes,
      config?.music?.suno?.submitMode === "manual" ? "manual_submit" : "captcha_fallback"
    ),
    filterCrossSongTakeUrls: async (songId, urls) => {
      if (!workspaceRoot || urls.length === 0) {
        return urls;
      }
      const collisions = await findTakeAttributionCollisions(workspaceRoot, songId, urls).catch(() => []);
      if (collisions.length === 0) {
        return urls;
      }
      const colliding = new Set(collisions.map((collision) => collision.url));
      return urls.filter((url) => !colliding.has(url));
    }
  });
}
