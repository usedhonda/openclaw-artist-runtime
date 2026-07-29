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
 * Fetch the account's recent feed clips using the vendored Clerk JWT. Returns [] on any
 * auth/network/shape failure so the caller cleanly falls back to the DOM harvest. The JWT
 * is used only as an Authorization header and never logged.
 */
export async function fetchSunoFeedClips(options: FetchSunoFeedClipsOptions): Promise<SunoFeedClip[]> {
  const base = options.baseUrl ?? SUNO_STUDIO_API_BASE;
  const doFetch = options.fetchImpl ?? fetch;
  let jwt: string | undefined;
  try {
    const clerk = await (options.clerkLoader ?? loadVendorClerk)();
    const token = await clerk.getClerkToken({ sessionFile: options.sessionFile });
    jwt = readString(token?.jwt);
  } catch {
    return [];
  }
  if (!jwt) {
    return [];
  }
  const headers = { authorization: `Bearer ${jwt}`, accept: "application/json" };
  for (const path of FEED_PATHS) {
    try {
      const res = await doFetch(base + path, { headers });
      if (!res.ok) {
        continue;
      }
      const body = (await res.json()) as unknown;
      const clips = extractFeedClips(body);
      if (clips.length > 0) {
        return clips;
      }
    } catch {
      // try the next listing shape
    }
  }
  return [];
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
