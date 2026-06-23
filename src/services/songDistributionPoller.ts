import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ChangeSetProposal } from "./freeformChangesetProposer.js";
import { listSongStates } from "./artistState.js";
import { secretLikePattern } from "./personaMigrator.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";
import { getArtistIdentity, getSpotifyBearerToken } from "./runtimeConfig.js";

export type DistributionPlatform = "unitedMasters" | "spotify" | "appleMusic";

export interface DistributionDetectionEntry {
  url?: string;
  detectedAt?: string;
  lastCheckedAt?: string;
}

export interface DistributionDetectionState {
  detected: Record<DistributionPlatform, DistributionDetectionEntry>;
  songs: Record<string, Partial<Record<DistributionPlatform, DistributionDetectionEntry>>>;
  updatedAt: string;
}

export interface SongDistributionPollerOptions {
  fetchImpl?: typeof fetch;
  now?: Date;
  unitedMastersProfileUrl?: string;
  spotifyBearerToken?: string;
  appleMusicArtistId?: string;
  appleMusicLocale?: string;
}

export interface SongDistributionDetection {
  songId: string;
  title: string;
  platform: DistributionPlatform;
  url: string;
  detectedAt: string;
  proposal: ChangeSetProposal;
}

export interface SongDistributionPollResult {
  checkedSongs: number;
  detections: SongDistributionDetection[];
  warnings: string[];
  state: DistributionDetectionState;
}

const defaultAppleMusicArtistId = "";
const defaultAppleMusicLocale = "jp";
const defaultUnitedMastersProfileUrl = "";

function statePath(root: string): string {
  return join(root, "runtime", "distribution-detection.json");
}

function emptyState(now = new Date()): DistributionDetectionState {
  const checkedAt = now.toISOString();
  return {
    detected: {
      unitedMasters: { lastCheckedAt: checkedAt },
      spotify: { lastCheckedAt: checkedAt },
      appleMusic: { lastCheckedAt: checkedAt }
    },
    songs: {},
    updatedAt: now.toISOString()
  };
}

function normalizeState(value: unknown, now = new Date()): DistributionDetectionState {
  if (typeof value !== "object" || value === null) {
    return emptyState(now);
  }
  const input = value as Partial<DistributionDetectionState>;
  return {
    detected: {
      unitedMasters: input.detected?.unitedMasters ?? {},
      spotify: input.detected?.spotify ?? {},
      appleMusic: input.detected?.appleMusic ?? {}
    },
    songs: typeof input.songs === "object" && input.songs !== null ? input.songs : {},
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : now.toISOString()
  };
}

export async function readDistributionDetectionState(root: string, now = new Date()): Promise<DistributionDetectionState> {
  const contents = await readFile(statePath(root), "utf8").catch(() => "");
  if (!contents) {
    return emptyState(now);
  }
  try {
    return normalizeState(JSON.parse(contents), now);
  } catch {
    return emptyState(now);
  }
}

async function writeDistributionDetectionState(root: string, state: DistributionDetectionState): Promise<DistributionDetectionState> {
  const path = statePath(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return state;
}

function containsSecret(value: string): boolean {
  return secretLikePattern.test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findUrlNearTitle(contents: string, title: string, platform: DistributionPlatform): string | undefined {
  if (!contents || containsSecret(contents)) {
    return undefined;
  }
  const titlePattern = new RegExp(escapeRegExp(title).replace(/\\\s+/g, "\\s+"), "i");
  const urls = contents.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  for (const url of urls) {
    const start = Math.max(0, contents.indexOf(url) - 500);
    const end = Math.min(contents.length, contents.indexOf(url) + url.length + 500);
    const window = contents.slice(start, end);
    if (titlePattern.test(window) && platformUrlMatches(url, platform)) {
      return url;
    }
  }
  return undefined;
}

function platformUrlMatches(url: string, platform: DistributionPlatform): boolean {
  switch (platform) {
    case "unitedMasters":
      return /unitedmasters\.com/i.test(url);
    case "spotify":
      return /open\.spotify\.com/i.test(url);
    case "appleMusic":
      return /music\.apple\.com/i.test(url) || /itunes\.apple\.com/i.test(url);
  }
}

async function fetchText(fetchImpl: typeof fetch, url: string, init?: RequestInit): Promise<string> {
  const response = await fetchImpl(url, init);
  const text = await response.text();
  if (containsSecret(text)) {
    throw new Error("distribution_response_contains_secret_like_text");
  }
  return text;
}

async function pollUnitedMasters(fetchImpl: typeof fetch, title: string, options: SongDistributionPollerOptions): Promise<string | undefined> {
  const url = options.unitedMastersProfileUrl ?? defaultUnitedMastersProfileUrl;
  if (!url) {
    return undefined;
  }
  const text = await fetchText(fetchImpl, url);
  return findUrlNearTitle(text, title, "unitedMasters");
}

async function pollSpotify(fetchImpl: typeof fetch, title: string, artistName: string, token: string | undefined): Promise<string | undefined> {
  if (!token) {
    return undefined;
  }
  const query = encodeURIComponent(`track:${title} artist:${artistName}`);
  const text = await fetchText(fetchImpl, `https://api.spotify.com/v1/search?type=track&limit=5&q=${query}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const parsed = JSON.parse(text) as { tracks?: { items?: Array<{ external_urls?: { spotify?: string }; name?: string }> } };
  return parsed.tracks?.items?.find((item) => item.external_urls?.spotify)?.external_urls?.spotify;
}

async function pollAppleMusic(fetchImpl: typeof fetch, title: string, options: SongDistributionPollerOptions): Promise<string | undefined> {
  const artistId = options.appleMusicArtistId ?? defaultAppleMusicArtistId;
  if (!artistId) {
    return undefined;
  }
  const locale = options.appleMusicLocale ?? defaultAppleMusicLocale;
  const text = await fetchText(fetchImpl, `https://itunes.apple.com/lookup?id=${encodeURIComponent(artistId)}&entity=song&limit=200&country=${encodeURIComponent(locale)}`);
  const parsed = JSON.parse(text) as { results?: Array<{ wrapperType?: string; trackName?: string; trackViewUrl?: string }> };
  const normalizedTitle = title.trim().toLowerCase();
  return parsed.results?.find((item) =>
    item.wrapperType === "track" && item.trackName?.trim().toLowerCase() === normalizedTitle && item.trackViewUrl
  )?.trackViewUrl;
}

export function proposalForDetection(detection: Omit<SongDistributionDetection, "proposal">): ChangeSetProposal {
  const field = detection.platform === "spotify"
    ? "publicLinksSpotify"
    : detection.platform === "appleMusic"
      ? "publicLinksAppleMusic"
      : "publicLinksOther";
  return {
    id: `distribution-${detection.songId}-${detection.platform}-${Date.now().toString(36)}`,
    domain: "song",
    summary: `${detection.platform} link detected for ${detection.title}.`,
    fields: [
      {
        domain: "song",
        targetFile: join("artist", "SONGBOOK.md"),
        field,
        proposedValue: detection.url,
        currentValue: "",
        reasoning: "distribution polling detected a public DSP URL",
        status: "proposed"
      }
    ],
    warnings: [],
    createdAt: detection.detectedAt,
    source: "conversation",
    songId: detection.songId,
    platform: detection.platform
  };
}

function updateStateForCheck(
  state: DistributionDetectionState,
  songId: string,
  platform: DistributionPlatform,
  nowIso: string,
  url?: string
): boolean {
  state.songs[songId] ??= {};
  const previous = state.songs[songId][platform];
  const next: DistributionDetectionEntry = {
    ...previous,
    lastCheckedAt: nowIso,
    ...(url ? { url, detectedAt: previous?.url === url && previous.detectedAt ? previous.detectedAt : nowIso } : {})
  };
  state.songs[songId][platform] = next;
  state.detected[platform] = {
    ...state.detected[platform],
    lastCheckedAt: nowIso,
    ...(url ? { url: next.url, detectedAt: next.detectedAt } : {})
  };
  return Boolean(url && previous?.url !== url);
}

export async function pollSongDistribution(root: string, options: SongDistributionPollerOptions = {}): Promise<SongDistributionPollResult> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const fetchImpl = options.fetchImpl ?? fetch;
  const state = await readDistributionDetectionState(root, now);
  const warnings: string[] = [];
  const detections: SongDistributionDetection[] = [];
  const songs = (await listSongStates(root)).filter((song) => song.status === "scheduled");
  const artistName = (await getArtistIdentity(root)).artistName;

  for (const song of songs) {
    const checks: Array<[DistributionPlatform, Promise<string | undefined>]> = [
      ["unitedMasters", pollUnitedMasters(fetchImpl, song.title, options)],
      ["spotify", pollSpotify(fetchImpl, song.title, artistName, options.spotifyBearerToken ?? getSpotifyBearerToken())],
      ["appleMusic", pollAppleMusic(fetchImpl, song.title, options)]
    ];
    for (const [platform, promise] of checks) {
      try {
        const url = await promise;
        const isNew = updateStateForCheck(state, song.songId, platform, nowIso, url);
        if (url && isNew) {
          const detectionWithoutProposal = { songId: song.songId, title: song.title, platform, url, detectedAt: nowIso };
          const proposal = proposalForDetection(detectionWithoutProposal);
          const detection = { ...detectionWithoutProposal, proposal };
          detections.push(detection);
          emitRuntimeEvent({
            type: "distribution_change_detected",
            songId: song.songId,
            platform,
            url,
            proposalId: proposal.id,
            proposal,
            timestamp: now.getTime()
          });
        }
      } catch (error) {
        warnings.push(`${platform}:${error instanceof Error ? error.message : String(error)}`);
        updateStateForCheck(state, song.songId, platform, nowIso);
      }
    }
  }

  const written = await writeDistributionDetectionState(root, { ...state, updatedAt: nowIso });
  return { checkedSongs: songs.length, detections, warnings, state: written };
}
