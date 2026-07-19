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
        const clips = extractFeedClips(payload);
        return clips.map(normalizeClip);
    }
}
export function normalizeClip(clip) {
    const audioUrl = typeof clip.audio_url === "string" && clip.audio_url.length > 0 ? clip.audio_url : null;
    const audioReady = isAudioReady(audioUrl);
    const status = audioReady ? "audio_ready" : (clip.status ?? "url_ready");
    return {
        clipId: clip.id,
        songUrl: toSongUrl(clip.id),
        status,
        ...(typeof clip.title === "string" ? { title: clip.title } : {}),
        audioReady,
        audioUrl,
        raw: clip
    };
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
