import { isAudioReady } from "../safety/audio.js";
const DEFAULT_FEED_ENDPOINT = "https://studio-api-prod.suno.com/api/feed/v3";
export class FeedClient {
    jwt;
    fetcher;
    endpoint;
    constructor(options) {
        this.jwt = options.jwt;
        this.fetcher = options.fetcher ?? fetch;
        this.endpoint = options.endpoint ?? DEFAULT_FEED_ENDPOINT;
    }
    async getClips(clipIds) {
        const response = await this.fetcher(this.endpoint, {
            method: "POST",
            headers: {
                authorization: `Bearer ${this.jwt}`,
                accept: "application/json",
                "content-type": "application/json"
            },
            body: JSON.stringify({ ids: clipIds })
        });
        if (!response.ok) {
            throw new Error(`Suno feed request failed: HTTP ${response.status}`);
        }
        const payload = await response.json();
        const clipsById = new Map(extractFeedClips(payload).map((clip) => [clip.id, clip]));
        const requestedIds = [...new Set(clipIds)];
        const missingIds = requestedIds.filter((clipId) => !clipsById.has(clipId));
        if (missingIds.length > 0) {
            const error = new Error(`Suno feed response missing requested clip id(s): ${missingIds.join(", ")}`);
            error.code = "suno_feed_target_missing";
            throw error;
        }
        return requestedIds.map((clipId) => normalizeClip(clipsById.get(clipId)));
    }
}
export function normalizeClip(clip) {
    const primaryUrl = typeof clip.audio_url === "string" && clip.audio_url.length > 0 ? clip.audio_url : null;
    const primaryReady = isAudioReady(primaryUrl);
    const fallback = primaryReady ? null : selectMediaUrlFallback(clip.media_urls);
    const audioUrl = primaryReady ? primaryUrl : (fallback ? fallback.url : primaryUrl);
    const audioReady = primaryReady || Boolean(fallback);
    const audioFormat = fallback ? fallback.format : deriveAudioFormat(primaryUrl);
    const status = audioReady ? "audio_ready" : (clip.status ?? "url_ready");
    return {
        clipId: clip.id,
        songUrl: toSongUrl(clip.id),
        status,
        ...(typeof clip.title === "string" ? { title: clip.title } : {}),
        audioReady,
        audioUrl,
        ...(audioFormat ? { audioFormat } : {}),
        raw: clip
    };
}
// Suno's forbidden-placeholder `audio_url` (`/api/forbidden`, gated behind
// `is_download_unlocked`) no longer carries the audio. `media_urls` still exposes an
// anonymously downloadable CloudFront progressive stream (m4a/opus today), so fall
// back to it when the primary `audio_url` is not ready.
function selectMediaUrlFallback(mediaUrls) {
    if (!Array.isArray(mediaUrls))
        return null;
    const candidates = mediaUrls.filter((entry) => entry && typeof entry === "object" && typeof entry.url === "string" && /^https:\/\//i.test(entry.url));
    if (candidates.length === 0)
        return null;
    const picked = candidates.find((entry) => entry.delivery === "progressive") ?? candidates[0];
    return { url: picked.url, format: deriveAudioFormat(picked.url, picked.content_type) };
}
function deriveAudioFormat(url, contentType) {
    if (typeof contentType === "string") {
        if (contentType.toLowerCase().startsWith("m4a"))
            return "m4a";
        if (contentType.toLowerCase().startsWith("mp3"))
            return "mp3";
    }
    if (typeof url === "string") {
        const match = url.match(/\.([a-z0-9]+)(?:\?|$)/i);
        if (match)
            return match[1].toLowerCase();
    }
    return null;
}
export function extractFeedClips(payload) {
    const candidates = collectCandidates(payload);
    return candidates.filter((item) => {
        return Boolean(item && typeof item === "object" && "id" in item && typeof item.id === "string");
    });
}
export function toSongUrl(clipId) {
    return `https://suno.com/song/${clipId}`;
}
function collectCandidates(payload) {
    if (Array.isArray(payload))
        return payload;
    if (!payload || typeof payload !== "object")
        return [];
    const record = payload;
    for (const key of ["clips", "songs", "items", "data"]) {
        const value = record[key];
        if (Array.isArray(value))
            return value;
        if (value && typeof value === "object") {
            const nested = collectCandidates(value);
            if (nested.length > 0)
                return nested;
        }
    }
    return [];
}
