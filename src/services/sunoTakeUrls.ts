import { PLAYWRIGHT_EXPECTED_CREATE_CARD_COUNT } from "./sunoTakeConstants.js";

// Suno always produces exactly two takes per generation and both take-page URLs are
// available together. The delivery contract is "both URLs together": a
// suno_take_url_ready notification must carry BOTH take URLs, deduped, and must not fire
// with a single URL while a second is (or will imminently be) available. The expected
// count is the same constant the DOM create driver already enforces, so it stays a single
// source of truth instead of hardcoding 2 in several places.
export const EXPECTED_SUNO_TAKE_URLS = PLAYWRIGHT_EXPECTED_CREATE_CARD_COUNT;

// Bounded fallback: if only one take URL ever materializes, deliver the single URL rather
// than never delivering (fail-open). Mirrors the env-override shape of the other Suno
// timeout constants in autopilotService (e.g. OPENCLAW_SUNO_IMPORT_STALL_MINUTES).
export const DEFAULT_SINGLE_TAKE_URL_FALLBACK_MS = 5 * 60 * 1000;
export const SINGLE_TAKE_URL_FALLBACK_REASON = "single_take_url_fallback";

const SUNO_TAKE_URL_PATTERN = /^https?:\/\/(?:www\.)?suno\.com\/song\/([^/?#]+)/i;

export function singleTakeUrlFallbackMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.OPENCLAW_SUNO_SINGLE_TAKE_FALLBACK_MINUTES?.trim();
  if (!raw) {
    return DEFAULT_SINGLE_TAKE_URL_FALLBACK_MS;
  }
  const minutes = Number(raw);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 * 1000 : DEFAULT_SINGLE_TAKE_URL_FALLBACK_MS;
}

// Collect distinct valid Suno take-page URLs, deduped by take id, preserving order.
export function collectSunoTakeUrls(urls: string[] = []): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of urls) {
    const match = url?.match(SUNO_TAKE_URL_PATTERN);
    if (!match) {
      continue;
    }
    const takeId = match[1];
    if (seen.has(takeId)) {
      continue;
    }
    seen.add(takeId);
    result.push(url);
  }
  return result;
}

export interface SunoTakeUrlReadiness {
  // Whether the run should fire suno_take_url_ready this cycle.
  emit: boolean;
  // Deduped take URLs to carry on the event (both when available, otherwise the single URL).
  urls: string[];
  // True when firing on fewer than EXPECTED_SUNO_TAKE_URLS via the bounded fallback.
  fallback: boolean;
}

// Decide whether an accepted run is ready to deliver its take URLs.
// - >= EXPECTED distinct take URLs: emit both together.
// - exactly 1 distinct take URL, within the fallback window: hold (do not emit yet).
// - exactly 1 distinct take URL, past the fallback window: emit the single URL (fallback).
// - 0 take URLs: nothing to deliver.
export function evaluateSunoTakeUrlReadiness(
  urls: string[] = [],
  createdAtMs: number | undefined,
  now: number = Date.now(),
  env: NodeJS.ProcessEnv = process.env
): SunoTakeUrlReadiness {
  const takeUrls = collectSunoTakeUrls(urls);
  if (takeUrls.length === 0) {
    return { emit: false, urls: [], fallback: false };
  }
  if (takeUrls.length >= EXPECTED_SUNO_TAKE_URLS) {
    return { emit: true, urls: takeUrls, fallback: false };
  }
  const waitedMs = createdAtMs === undefined || Number.isNaN(createdAtMs)
    ? Number.POSITIVE_INFINITY
    : now - createdAtMs;
  if (waitedMs >= singleTakeUrlFallbackMs(env)) {
    return { emit: true, urls: takeUrls, fallback: true };
  }
  return { emit: false, urls: takeUrls, fallback: false };
}
