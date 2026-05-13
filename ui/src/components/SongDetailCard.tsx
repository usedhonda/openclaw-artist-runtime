import { useEffect, useMemo, useState } from "react";

const apiBase = "/plugins/artist-runtime/api";
const defaultEventStreamUrl = `${apiBase}/events/stream`;

type SongState = {
  songId: string;
  title?: string;
  status?: string;
  briefPath?: string;
  lyricsVersion?: number | string;
  runCount?: number;
  selectedTake?: string;
  publicLinks?: string[];
  lastReason?: string;
  lastImportOutcome?: string;
  degradedLyrics?: boolean;
  observationSummary?: string;
  updatedAt?: string;
  createdAt?: string;
};

type PromptLedgerEntry = {
  promptPackVersion?: number | string;
  stage?: string;
  createdAt?: string;
  source?: string;
};

type SunoRun = {
  runId?: string;
  startedAt?: string;
  status?: string;
  takeIds?: string[];
};

type SocialAction = {
  platform?: string;
  action?: string;
  status?: string;
  url?: string;
  postedAt?: string;
};

type SongDetailResponse = {
  song?: SongState | null;
  brief?: string;
  promptLedger?: PromptLedgerEntry[];
  sunoRuns?: SunoRun[];
  selectedTake?: unknown;
  socialAssets?: unknown[];
  lastSocialAction?: SocialAction | null;
  latestPromptPack?: { version?: number | string } | null;
};

type RuntimeEvent = {
  type: string;
  songId?: string;
  selectedTakeId?: string;
  timestamp?: number;
  reason?: string;
  takeUrl?: string;
  url?: string;
  draftHash?: string;
};

type SongEventsResponse = {
  events?: RuntimeEvent[];
};

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBase}${path}`);
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function parseRuntimeEvent(data: string): RuntimeEvent | undefined {
  try {
    const parsed = JSON.parse(data) as RuntimeEvent;
    return typeof parsed.type === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function eventKey(event: RuntimeEvent): string {
  return `${event.type}:${event.songId ?? ""}:${event.selectedTakeId ?? ""}:${event.timestamp ?? 0}`;
}

function mergeEvents(current: RuntimeEvent[], next: RuntimeEvent[]): RuntimeEvent[] {
  const seen = new Set<string>();
  return [...current, ...next]
    .filter((event) => {
      const key = eventKey(event);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
}

function formatTimestamp(value?: string | number): string {
  if (!value) return "-";
  try {
    const date = typeof value === "number" ? new Date(value) : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("ja-JP", { hour12: false });
  } catch {
    return String(value);
  }
}

function relativePath(absolute: string | undefined, songId: string): string {
  if (!absolute) return "";
  const idx = absolute.indexOf(`/songs/${songId}/`);
  if (idx >= 0) return absolute.slice(idx + 1);
  const fallback = absolute.split("/").slice(-3).join("/");
  return fallback;
}

export interface SongDetailCardProps {
  songId: string;
  onBack: () => void;
  eventStreamUrl?: string;
}

export function SongDetailCard(props: SongDetailCardProps) {
  const { songId, onBack } = props;
  const [detail, setDetail] = useState<SongDetailResponse | null>(null);
  const [events, setEvents] = useState<RuntimeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    setEvents([]);

    async function load() {
      try {
        const [detailRes, eventsRes] = await Promise.all([
          fetchJson<SongDetailResponse>(`/songs/${encodeURIComponent(songId)}`),
          fetchJson<SongEventsResponse>(`/songs/${encodeURIComponent(songId)}/events?limit=50`).catch(() => ({ events: [] }))
        ]);
        if (cancelled) return;
        setDetail(detailRes);
        setEvents([...(eventsRes.events ?? [])].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)));
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [songId]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.EventSource !== "function") {
      return undefined;
    }
    const source = new window.EventSource(props.eventStreamUrl ?? defaultEventStreamUrl);
    source.onmessage = (message) => {
      const event = parseRuntimeEvent(message.data);
      if (!event || event.songId !== songId) return;
      setEvents((current) => mergeEvents(current, [event]));
    };
    source.onerror = () => {
      source.close();
    };
    return () => {
      source.close();
    };
  }, [props.eventStreamUrl, songId]);

  const song = detail?.song ?? undefined;
  const title = song?.title || songId;
  const briefPath = relativePath(song?.briefPath, songId);
  const lyricsPath = `songs/${songId}/lyrics-suno.md`;
  const songPath = `songs/${songId}/song.md`;
  const publicLinks = useMemo(() => song?.publicLinks?.filter((link) => link && link !== "(none)") ?? [], [song?.publicLinks]);

  return (
    <article className="panel song-detail-card">
      <div className="song-detail-header">
        <button type="button" className="song-detail-back" onClick={onBack}>&larr; list に戻る</button>
        <div className="song-detail-title-row">
          <strong>{title}</strong>
          <span className="muted">{songId}</span>
        </div>
      </div>

      {loading ? (
        <div className="item muted">Loading song detail…</div>
      ) : error ? (
        <div className="item muted">Failed to load: {error}</div>
      ) : !song ? (
        <div className="item muted">Song not found.</div>
      ) : (
        <>
          <dl className="song-detail-status">
            <div><dt>Status</dt><dd>{song.status ?? "-"}</dd></div>
            <div><dt>Lyrics</dt><dd>v{song.lyricsVersion ?? "-"}</dd></div>
            <div><dt>Runs</dt><dd>{song.runCount ?? 0}</dd></div>
            <div><dt>Selected Take</dt><dd>{song.selectedTake || "-"}</dd></div>
            <div><dt>Updated</dt><dd>{formatTimestamp(song.updatedAt)}</dd></div>
            <div><dt>Degraded</dt><dd>{song.degradedLyrics ? "yes" : "no"}</dd></div>
          </dl>

          {song.lastReason ? (
            <div className="item song-detail-reason">
              <div className="muted">Last reason</div>
              <div>{song.lastReason}</div>
            </div>
          ) : null}

          <div className="song-detail-resources">
            <div className="muted">Local files</div>
            <ul>
              {briefPath ? <li><code>{briefPath}</code></li> : null}
              <li><code>{lyricsPath}</code></li>
              <li><code>{songPath}</code></li>
            </ul>
          </div>

          {publicLinks.length > 0 ? (
            <div className="song-detail-resources">
              <div className="muted">Public links</div>
              <ul>
                {publicLinks.map((link) => (
                  <li key={link}><a href={link} target="_blank" rel="noreferrer">{link}</a></li>
                ))}
              </ul>
            </div>
          ) : null}

          {detail?.lastSocialAction?.url ? (
            <div className="song-detail-resources">
              <div className="muted">Last social action</div>
              <ul>
                <li>
                  <a href={detail.lastSocialAction.url} target="_blank" rel="noreferrer">
                    {detail.lastSocialAction.platform ?? "social"} · {detail.lastSocialAction.action ?? ""} · {detail.lastSocialAction.status ?? ""}
                  </a>
                </li>
              </ul>
            </div>
          ) : null}

          <div className="song-detail-events">
            <div className="muted">Recent events ({events.length})</div>
            {events.length === 0 ? (
              <div className="item muted">No events recorded.</div>
            ) : (
              <ul>
                {events.slice(0, 20).map((event) => (
                  <li key={eventKey(event)}>
                    <span className="song-detail-event-time">{formatTimestamp(event.timestamp)}</span>
                    <span className="song-detail-event-type">{event.type}</span>
                    {event.reason ? <span className="muted"> · {event.reason}</span> : null}
                    {event.takeUrl || event.url ? (
                      <>
                        {" · "}
                        <a href={event.takeUrl ?? event.url} target="_blank" rel="noreferrer">link</a>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="song-detail-meta muted">
            prompt ledger {detail?.promptLedger?.length ?? 0} entries · suno runs {detail?.sunoRuns?.length ?? 0}
          </div>
        </>
      )}
    </article>
  );
}
