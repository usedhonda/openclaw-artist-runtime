import { PLAYWRIGHT_EXPECTED_CREATE_CARD_COUNT } from "./sunoTakeConstants.js";

/**
 * Network-primary take harvest.
 *
 * The create-page DOM harvest (readSunoCreateCardSongUrls) title-scopes to the created
 * song yet can walk to a neighbouring card's thumbnail, mis-attributing another song's
 * take id (the cross-song bleed that rejected an otherwise-successful create; memory
 * `project-suno-harvest-cross-card-bleed`). Suno's authenticated feed API is the
 * authoritative source of "which clips this account just produced", so after a machine
 * or human submit fires a real generate we reconcile the take URLs from the feed and
 * fall back to the DOM only when the feed is unavailable.
 *
 * Auth reuses the vendored suno-cli Clerk token exchange (session.json -> JWT). The JWT
 * is never logged.
 */

const SUNO_STUDIO_API_BASE = "https://studio-api-prod.suno.com";
// Try the newest listing shape first; fall back to the prior one. Matches the shapes the
// on-device feed diagnostic confirmed return the account's recent clips.
const FEED_PATHS = ["/api/feed/v3?page=0", "/api/feed/v2?page=0"] as const;
// Absorb small clock skew between the plugin host and Suno's servers when comparing a
// clip's created_at against the local submit time. The pre-submit baseline id set is the
// primary "not pre-existing" guard; this window only keeps skew from dropping a genuine
// fresh take.
const CLOCK_SKEW_TOLERANCE_MS = 120_000;
// The feed reflects a fresh generate a few seconds after submit (observed ~9s
// on-device), so a bounded poll gives it time to catch up before the caller decides
// between a genuine "no match" (feed reachable, fall back to DOM) and "unreachable"
// (never once reached the feed -- must NOT fall back, the DOM alone is untrusted).
const DEFAULT_FEED_RECONCILE_ATTEMPTS = 30;
const DEFAULT_FEED_RECONCILE_INTERVAL_MS = 3_000;

export interface SunoFeedClip {
  id?: unknown;
  title?: unknown;
  created_at?: unknown;
  status?: unknown;
}

export interface FeedTakeSelection {
  /** Fresh title-scoped take URLs for this create, capped at the expected take count. */
  urls: string[];
  /**
   * True when more than the expected number of fresh feed matches appear — a scope
   * anomaly. Mirrors filterFreshTakeUrls: the caller must NOT treat this as success and
   * should fall back (never fabricate a run from an over-count).
   */
  overCount: boolean;
}

export function feedClipSongUrl(id: string): string {
  return `https://suno.com/song/${id}`;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseCreatedMs(value: unknown): number | undefined {
  const text = readString(value);
  if (!text) {
    return undefined;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Pure selection: pick the feed clips that belong to THIS create — exact title match,
 * created at/after the submit trigger (minus a small skew window), and absent from the
 * pre-submit baseline id set. Returns song URLs. More than the expected number of fresh
 * matches is an anomaly (urls: [], overCount: true), keeping parity with the DOM guard.
 */
export function selectFreshFeedTakeUrls(input: {
  clips: readonly SunoFeedClip[];
  title: string;
  sinceMs: number;
  baselineIds: ReadonlySet<string>;
  expectedCount?: number;
}): FeedTakeSelection {
  const expected = input.expectedCount ?? PLAYWRIGHT_EXPECTED_CREATE_CARD_COUNT;
  const wantTitle = input.title.trim();
  // An empty title cannot be scoped safely, so never harvest from the feed (the DOM
  // guard has the same fail-closed rule for an untitled create).
  if (!wantTitle) {
    return { urls: [], overCount: false };
  }
  const floorMs = input.sinceMs - CLOCK_SKEW_TOLERANCE_MS;
  const seen = new Set<string>();
  const fresh: string[] = [];
  for (const clip of input.clips) {
    const id = readString(clip.id);
    const title = readString(clip.title);
    if (!id || !title || title !== wantTitle) {
      continue;
    }
    if (input.baselineIds.has(id) || seen.has(id)) {
      continue;
    }
    const createdMs = parseCreatedMs(clip.created_at);
    // A clip with no parsable timestamp is not trusted as fresh; fail closed toward the
    // DOM fallback rather than adopt an ambiguous clip.
    if (createdMs === undefined || createdMs < floorMs) {
      continue;
    }
    seen.add(id);
    fresh.push(feedClipSongUrl(id));
  }
  if (fresh.length > expected) {
    return { urls: [], overCount: true };
  }
  return { urls: fresh, overCount: false };
}

interface ClerkTokenModule {
  getClerkToken: (options: { sessionFile?: string }) => Promise<{ jwt?: unknown }>;
}

// Resolve the vendored suno-cli Clerk token exchange. The path is the same relative depth
// from src/services and dist/services (services -> package root -> vendor), so it works in
// both the source and compiled/npm-packed layouts.
async function loadVendorClerk(): Promise<ClerkTokenModule> {
  const url = new URL("../../vendor/suno-cli/dist/src/auth/clerk.js", import.meta.url);
  return (await import(url.href)) as ClerkTokenModule;
}

export interface FetchSunoFeedClipsOptions {
  sessionFile: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  clerkLoader?: () => Promise<ClerkTokenModule>;
}

/**
 * Fixed, non-leaky codes for why the feed could not be reached. Never interpolate a
 * caught error's message into a reason surfaced here (or anywhere downstream: runtime
 * events, /api/status, HTTP bodies) -- the vendored Clerk exchange's error text is not
 * under this module's control and could echo request/response fragments.
 */
export type SunoFeedUnavailableReason =
  | "clerk_token_missing"
  | "clerk_token_error"
  | "http_error"
  | "network_error"
  | "feed_unreachable";

export interface SunoFeedFetchResult {
  clips: SunoFeedClip[];
  /**
   * True once any feed request actually completed (200, even with zero clips). False
   * means the feed was never reached -- expired/missing session, or every request
   * failed -- and callers must NOT treat an empty clip list as "no takes exist yet".
   */
  available: boolean;
  reason?: SunoFeedUnavailableReason;
}

/**
 * Fetch the account's recent feed clips using the vendored Clerk JWT, reporting whether
 * the feed was actually reachable (not just whether it returned clips). The JWT is used
 * only as an Authorization header and never logged; failure reasons are fixed codes, not
 * raw error text, so nothing caught here can leak into events, diagnostics, or HTTP
 * responses built from this result.
 */
export async function fetchSunoFeedStatus(options: FetchSunoFeedClipsOptions): Promise<SunoFeedFetchResult> {
  const base = options.baseUrl ?? SUNO_STUDIO_API_BASE;
  const doFetch = options.fetchImpl ?? fetch;
  let jwt: string | undefined;
  try {
    const clerk = await (options.clerkLoader ?? loadVendorClerk)();
    const token = await clerk.getClerkToken({ sessionFile: options.sessionFile });
    jwt = readString(token?.jwt);
  } catch {
    return { clips: [], available: false, reason: "clerk_token_error" };
  }
  if (!jwt) {
    return { clips: [], available: false, reason: "clerk_token_missing" };
  }
  const headers = { authorization: `Bearer ${jwt}`, accept: "application/json" };
  let reachedOk = false;
  let lastClips: SunoFeedClip[] = [];
  let lastReason: SunoFeedUnavailableReason = "feed_unreachable";
  for (const path of FEED_PATHS) {
    try {
      const res = await doFetch(base + path, { headers });
      if (!res.ok) {
        lastReason = "http_error";
        continue;
      }
      reachedOk = true;
      const body = (await res.json()) as unknown;
      const clips = extractFeedClips(body);
      if (clips.length > 0) {
        return { clips, available: true };
      }
      // Reached OK with no clips yet: keep polling the remaining listing shape before
      // settling, but this path alone already proves the feed is reachable.
      lastClips = clips;
    } catch {
      lastReason = "network_error";
    }
  }
  if (reachedOk) {
    return { clips: lastClips, available: true };
  }
  return { clips: [], available: false, reason: lastReason };
}

/**
 * Back-compat wrapper: returns just the clip list, [] on any auth/network/shape failure
 * (including a reachable-but-empty feed). Existing callers that only need "what clips
 * exist" keep working unchanged; callers that must distinguish "empty" from "unreachable"
 * should use fetchSunoFeedStatus directly.
 */
export async function fetchSunoFeedClips(options: FetchSunoFeedClipsOptions): Promise<SunoFeedClip[]> {
  return (await fetchSunoFeedStatus(options)).clips;
}

export function extractFeedClips(body: unknown): SunoFeedClip[] {
  if (Array.isArray(body)) {
    return body as SunoFeedClip[];
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  for (const key of ["clips", "songs", "items", "data", "project_clips"]) {
    const arr = record[key];
    if (Array.isArray(arr)) {
      return arr as SunoFeedClip[];
    }
  }
  return [];
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type FeedReconcileResult =
  | { status: "matched"; urls: string[] }
  /** Legacy DOM-only mode (no sessionFile) or feed reachable-but-no-match: trust the DOM. */
  | { status: "dom_fallback"; urls: string[] }
  /** sessionFile was configured but the feed was never reached across the whole poll:
   * the DOM result must NOT be trusted. An expired suno-cli session hitting this path
   * is exactly what let a cross-card DOM bleed get accepted as a real take (the
   * `project-suno-harvest-cross-card-bleed` incident). */
  | { status: "unavailable" };

export interface ReconcileFeedTakesInput {
  /** DOM-harvested take URLs already detected as "fresh" for this title. */
  domUrls: string[];
  /** Path to the suno-cli session.json. Undefined means DOM-only mode (tests, no workspace). */
  sessionFile: string | undefined;
  title: string;
  sinceMs: number;
  baselineIds: ReadonlySet<string>;
  expectedCount?: number;
  attempts?: number;
  intervalMs?: number;
  fetchFeed?: (options: FetchSunoFeedClipsOptions) => Promise<SunoFeedFetchResult>;
  sleep?: (ms: number) => Promise<void>;
  /** Called once if the feed itself reports a scope anomaly (more fresh matches than expected). */
  onOverCount?: () => void;
  /** Manual waits must never accept a DOM-only late card as a submitted take. */
  allowDomFallback?: boolean;
}

/**
 * Network-primary take reconciliation, extracted as a pure(ish) function so the
 * decision logic (matched / dom_fallback / unavailable) is unit-testable without a
 * live browser. Polls the feed up to `attempts` times (default ~90s total): a genuine
 * match returns immediately; a feed that is reachable at least once but never matches
 * falls back to the DOM result (pre-existing behaviour, unchanged); a feed that is
 * NEVER reached across every attempt returns "unavailable" so the caller can refuse to
 * trust the DOM result instead of silently accepting it.
 */
export async function reconcileFeedTakes(input: ReconcileFeedTakesInput): Promise<FeedReconcileResult> {
  const { domUrls, sessionFile } = input;
  if (!sessionFile) {
    return input.allowDomFallback === false ? { status: "unavailable" } : { status: "dom_fallback", urls: domUrls };
  }
  const attempts = input.attempts ?? DEFAULT_FEED_RECONCILE_ATTEMPTS;
  const intervalMs = input.intervalMs ?? DEFAULT_FEED_RECONCILE_INTERVAL_MS;
  const fetchFeed = input.fetchFeed ?? fetchSunoFeedStatus;
  const sleep = input.sleep ?? defaultSleep;
  let everAvailable = false;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const feedStatus = await fetchFeed({ sessionFile }).catch(
      (): SunoFeedFetchResult => ({ clips: [], available: false, reason: "network_error" })
    );
    if (feedStatus.available) {
      everAvailable = true;
    }
    const { urls, overCount } = selectFreshFeedTakeUrls({
      clips: feedStatus.clips,
      title: input.title,
      sinceMs: input.sinceMs,
      baselineIds: input.baselineIds,
      expectedCount: input.expectedCount
    });
    if (urls.length > 0) {
      return { status: "matched", urls };
    }
    if (overCount) {
      input.onOverCount?.();
      break;
    }
    if (attempt < attempts - 1) {
      await sleep(intervalMs);
    }
  }
  if (!everAvailable) {
    return { status: "unavailable" };
  }
  return input.allowDomFallback === false ? { status: "unavailable" } : { status: "dom_fallback", urls: domUrls };
}
