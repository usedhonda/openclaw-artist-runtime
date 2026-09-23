import { join } from "node:path";
import type { ArtistRuntimeConfig, SongStatus } from "../types.js";
import { readSongState } from "./artistState.js";
import { appendOperatorAttachedSunoRun } from "./sunoRuns.js";
import {
  appendTakeAttributionAudit,
  extractSunoTakeId,
  findTakeAttributionCollisions,
  type TakeAttributionCollision
} from "./takeAttributionGuard.js";
import { fetchSunoFeedStatus, type SunoFeedClip, type SunoFeedFetchResult } from "./sunoFeedHarvest.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";

/**
 * Operator recovery route for the exact incident this reliability work fixes: a manual
 * Suno create genuinely produced takes, but the automated pipeline could not confirm
 * attribution (feed unavailable, DOM cross-card ambiguity, etc.) and recorded the run as
 * failed. The operator supplies the take URLs directly, and this service confirms them
 * against the authenticated feed before attaching -- it never accepts a URL on trust
 * alone. `failed` is deliberately NOT in the terminal set below: it is the exact status
 * a 3-strike suno_generate_failed park leaves the song in (see
 * autopilotService.handleSunoGenerateFailure / retryPromptPackService, which already
 * treats `failed` as a recoverable operator lane, not a closed one).
 */
const terminalSongStatuses = new Set<SongStatus>(["scheduled", "published", "archived", "discarded"]);

// Suno take URLs are `https://suno.com/song/<uuid>`. Requiring the full UUID shape
// (rather than reusing extractSunoTakeId's permissive slug match) keeps an operator
// paste error -- a truncated id, a stray query string -- from being accepted at 400
// instead of silently mismatching downstream.
const SUNO_TAKE_URL_PATTERN =
  /^https:\/\/suno\.com\/song\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export type AttachSunoTakesResult =
  | { attached: false; statusCode: 400; reason: string }
  | { attached: false; statusCode: 404; reason: string }
  | { attached: false; statusCode: 409; reason: string; collisions?: TakeAttributionCollision[] }
  | { attached: false; statusCode: 422; reason: string }
  | { attached: false; statusCode: 503; reason: string }
  | { attached: true; statusCode: 200; songId: string; runId: string; urls: string[] };

export interface AttachSunoTakesInput {
  urls?: unknown;
  reason?: unknown;
}

export interface AttachSunoTakesDeps {
  /** Injectable for tests; defaults to the real network-primary feed client. */
  fetchStatus?: (options: { sessionFile: string }) => Promise<SunoFeedFetchResult>;
}

function sunoCliSessionFile(workspaceRoot: string): string {
  return join(workspaceRoot, "runtime", "suno", "cli", "session.json");
}

function normalizeUrls(rawUrls: unknown): string[] | undefined {
  if (!Array.isArray(rawUrls) || rawUrls.length === 0) {
    return undefined;
  }
  const urls = rawUrls.filter((url): url is string => typeof url === "string" && url.trim().length > 0);
  return urls.length === rawUrls.length ? urls : undefined;
}

export async function attachSunoTakes(
  workspaceRoot: string,
  songId: string,
  input: AttachSunoTakesInput,
  config?: Partial<ArtistRuntimeConfig>,
  deps: AttachSunoTakesDeps = {}
): Promise<AttachSunoTakesResult> {
  const urls = normalizeUrls(input.urls);
  if (!urls) {
    return { attached: false, statusCode: 400, reason: "urls_required" };
  }
  const invalidUrl = urls.find((url) => !SUNO_TAKE_URL_PATTERN.test(url));
  if (invalidUrl) {
    return { attached: false, statusCode: 400, reason: `invalid_take_url:${invalidUrl}` };
  }

  const song = await readSongState(workspaceRoot, songId).catch(() => undefined);
  if (!song) {
    return { attached: false, statusCode: 404, reason: "song_not_found" };
  }
  if (terminalSongStatuses.has(song.status)) {
    return { attached: false, statusCode: 409, reason: `song_is_terminal:${song.status}` };
  }

  const collisions = await findTakeAttributionCollisions(workspaceRoot, songId, urls).catch(() => []);
  if (collisions.length > 0) {
    return { attached: false, statusCode: 409, reason: "take_attribution_collision", collisions };
  }

  const fetchStatus = deps.fetchStatus ?? fetchSunoFeedStatus;
  const feedStatus = await fetchStatus({ sessionFile: sunoCliSessionFile(workspaceRoot) }).catch(
    (): SunoFeedFetchResult => ({ clips: [], available: false, reason: "network_error" })
  );
  if (!feedStatus.available) {
    return { attached: false, statusCode: 503, reason: feedStatus.reason ?? "feed_unreachable" };
  }

  const clipsById = new Map<string, SunoFeedClip>();
  for (const clip of feedStatus.clips) {
    const id = typeof clip.id === "string" && clip.id.trim() ? clip.id.trim() : undefined;
    if (id) {
      clipsById.set(id, clip);
    }
  }
  const wantTitle = song.title.trim();
  for (const url of urls) {
    const takeId = extractSunoTakeId(url);
    const clip = takeId ? clipsById.get(takeId) : undefined;
    const clipTitle = typeof clip?.title === "string" ? clip.title.trim() : undefined;
    if (!clip || clipTitle !== wantTitle) {
      return { attached: false, statusCode: 422, reason: `take_title_mismatch:${url}` };
    }
  }

  const reason = typeof input.reason === "string" && input.reason.trim() ? input.reason.trim() : "no reason given";
  const record = await appendOperatorAttachedSunoRun({ workspaceRoot, songId, urls, reason, config });

  await appendTakeAttributionAudit(workspaceRoot, "take_attribution_operator_attach", {
    songId,
    runId: record.runId,
    urls,
    reason
  });

  emitRuntimeEvent({
    type: "suno_take_attached_by_operator",
    songId,
    runId: record.runId,
    urls,
    reason,
    timestamp: Date.now()
  });

  return { attached: true, statusCode: 200, songId, runId: record.runId, urls };
}
