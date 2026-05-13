import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "./Breadcrumb";

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
  timestamp?: string;
  source?: string;
  songId?: string;
  runId?: string;
  metadata?: Record<string, unknown>;
};

type SunoTake = {
  takeId?: string;
  durationSec?: number | string;
  urlPublic?: string;
  urlPrivate?: string;
  status?: string;
  title?: string;
};

type SunoRun = {
  runId?: string;
  startedAt?: string;
  status?: string;
  takeIds?: string[];
  takes?: SunoTake[];
};

type SelectedTake = {
  selectedTakeId?: string;
  runId?: string;
  reason?: string;
  timestamp?: string;
  url?: string;
};

type TakeHistoryEntry = {
  selectedTakeId?: string;
  runId?: string;
  reason?: string;
  timestamp?: string;
};

type SocialAsset = {
  platform?: string;
  postType?: string;
  status?: string;
  path?: string;
};

type SocialAction = {
  platform?: string;
  action?: string;
  status?: string;
  url?: string;
  postedAt?: string;
  accepted?: boolean;
};

type SongDetailResponse = {
  song?: SongState | null;
  brief?: string;
  lyrics?: string;
  songMarkdown?: string;
  promptLedger?: PromptLedgerEntry[];
  sunoRuns?: SunoRun[];
  selectedTake?: SelectedTake | unknown;
  takeSelections?: PromptLedgerEntry[];
  takeHistory?: TakeHistoryEntry[];
  socialAssets?: SocialAsset[];
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

function asSelectedTake(value: unknown): SelectedTake | null {
  if (!value || typeof value !== "object") return null;
  return value as SelectedTake;
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
          fetchJson<SongEventsResponse>(`/songs/${encodeURIComponent(songId)}/events?limit=200`).catch(() => ({ events: [] }))
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
  const lyricsPath = `songs/${songId}/suno/lyrics-suno.md`;
  const songPath = `songs/${songId}/song.md`;
  const publicLinks = useMemo(() => song?.publicLinks?.filter((link) => link && link !== "(none)") ?? [], [song?.publicLinks]);
  const selectedTake = useMemo(() => asSelectedTake(detail?.selectedTake), [detail?.selectedTake]);
  const sunoRuns = detail?.sunoRuns ?? [];
  const takeHistory = detail?.takeHistory ?? [];
  const promptLedger = detail?.promptLedger ?? [];
  const socialAssets = detail?.socialAssets ?? [];
  const lastSocialAction = detail?.lastSocialAction ?? null;

  return (
    <article className="panel song-detail-card">
      <div className="song-detail-header">
        <Breadcrumb
          segments={[
            { label: "Songs", onClick: onBack },
            { label: title }
          ]}
        />
        <button type="button" className="song-detail-back" onClick={onBack}>&larr; Songs</button>
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

          {song.observationSummary ? (
            <div className="item song-detail-reason">
              <div className="muted">Observation summary</div>
              <div>{song.observationSummary}</div>
            </div>
          ) : null}

          <details className="song-detail-section" open>
            <summary><strong>Brief</strong> <span className="muted">({(detail?.brief ?? "").length} chars)</span></summary>
            <pre className="song-detail-pre">{detail?.brief || "(no brief)"}</pre>
          </details>

          <details className="song-detail-section">
            <summary><strong>Lyrics</strong> <span className="muted">({(detail?.lyrics ?? "").length} chars)</span></summary>
            <pre className="song-detail-pre">{detail?.lyrics || "(no lyrics)"}</pre>
          </details>

          <details className="song-detail-section">
            <summary><strong>song.md</strong> <span className="muted">({(detail?.songMarkdown ?? "").length} chars)</span></summary>
            <pre className="song-detail-pre">{detail?.songMarkdown || "(no song.md)"}</pre>
          </details>

          <details className="song-detail-section" open>
            <summary><strong>Suno runs</strong> <span className="muted">({sunoRuns.length})</span></summary>
            {sunoRuns.length === 0 ? (
              <div className="item muted">No runs yet.</div>
            ) : (
              <ul className="song-detail-runs">
                {sunoRuns.map((run, idx) => (
                  <li key={run.runId ?? idx} className="song-detail-run">
                    <div>
                      <strong>{run.runId ?? `run#${idx}`}</strong>
                      <span className="muted"> · {formatTimestamp(run.startedAt)} · {run.status ?? "-"}</span>
                    </div>
                    {(run.takes && run.takes.length > 0) ? (
                      <ul className="song-detail-takes">
                        {run.takes.map((take, takeIdx) => (
                          <li key={take.takeId ?? takeIdx}>
                            <span className="song-detail-take-id">{take.takeId ?? `take#${takeIdx}`}</span>
                            {take.title ? <span className="muted"> · {take.title}</span> : null}
                            {take.durationSec ? <span className="muted"> · {take.durationSec}s</span> : null}
                            {take.status ? <span className="muted"> · {take.status}</span> : null}
                            {take.urlPublic ? <> · <a href={take.urlPublic} target="_blank" rel="noreferrer">public</a></> : null}
                            {take.urlPrivate ? <> · <a href={take.urlPrivate} target="_blank" rel="noreferrer">private</a></> : null}
                          </li>
                        ))}
                      </ul>
                    ) : (run.takeIds && run.takeIds.length > 0) ? (
                      <div className="muted song-detail-take-ids">takeIds: {run.takeIds.join(", ")}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </details>

          <details className="song-detail-section" open>
            <summary><strong>Selected take</strong></summary>
            {selectedTake ? (
              <dl className="song-detail-status">
                <div><dt>Take ID</dt><dd>{selectedTake.selectedTakeId ?? "-"}</dd></div>
                <div><dt>Run</dt><dd>{selectedTake.runId ?? "-"}</dd></div>
                <div><dt>Reason</dt><dd>{selectedTake.reason ?? "-"}</dd></div>
                <div><dt>Picked at</dt><dd>{formatTimestamp(selectedTake.timestamp)}</dd></div>
                {selectedTake.url ? <div><dt>URL</dt><dd><a href={selectedTake.url} target="_blank" rel="noreferrer">{selectedTake.url}</a></dd></div> : null}
              </dl>
            ) : (
              <div className="item muted">No take selected yet.</div>
            )}
          </details>

          <details className="song-detail-section">
            <summary><strong>Take history</strong> <span className="muted">({takeHistory.length})</span></summary>
            {takeHistory.length === 0 ? (
              <div className="item muted">No prior selections.</div>
            ) : (
              <ul className="song-detail-take-history">
                {takeHistory.map((entry, idx) => (
                  <li key={`${entry.selectedTakeId ?? idx}:${entry.timestamp ?? idx}`}>
                    <span className="song-detail-event-time">{formatTimestamp(entry.timestamp)}</span>
                    <span className="song-detail-take-id"> · {entry.selectedTakeId ?? "-"}</span>
                    {entry.runId ? <span className="muted"> · {entry.runId}</span> : null}
                    {entry.reason ? <span className="muted"> · {entry.reason}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </details>

          <details className="song-detail-section">
            <summary><strong>Prompt ledger</strong> <span className="muted">({promptLedger.length})</span></summary>
            {promptLedger.length === 0 ? (
              <div className="item muted">No prompt ledger entries.</div>
            ) : (
              <ul className="song-detail-ledger">
                {promptLedger.map((entry, idx) => (
                  <li key={`${entry.timestamp ?? entry.createdAt ?? idx}-${idx}`}>
                    <div>
                      <strong>{entry.stage ?? "unknown_stage"}</strong>
                      <span className="muted"> · {formatTimestamp(entry.timestamp ?? entry.createdAt)}</span>
                      {entry.promptPackVersion ? <span className="muted"> · v{entry.promptPackVersion}</span> : null}
                      {entry.source ? <span className="muted"> · {entry.source}</span> : null}
                      {entry.runId ? <span className="muted"> · {entry.runId}</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </details>

          {detail?.latestPromptPack ? (
            <div className="item song-detail-reason">
              <div className="muted">Latest prompt pack</div>
              <div>v{detail.latestPromptPack.version ?? "-"} · {detail.takeSelections?.length ?? 0} take selections</div>
            </div>
          ) : null}

          <details className="song-detail-section">
            <summary><strong>Social assets</strong> <span className="muted">({socialAssets.length})</span></summary>
            {socialAssets.length === 0 ? (
              <div className="item muted">No social assets yet.</div>
            ) : (
              <ul>
                {socialAssets.map((asset, idx) => (
                  <li key={`${asset.platform ?? "unknown"}:${asset.postType ?? "type"}:${idx}`}>
                    <strong>{asset.platform ?? "?"}</strong>
                    <span className="muted"> · {asset.postType ?? "-"}</span>
                    {asset.status ? <span className="muted"> · {asset.status}</span> : null}
                    {asset.path ? <span className="muted"> · {asset.path}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </details>

          {lastSocialAction ? (
            <div className="song-detail-resources">
              <div className="muted">Last social action</div>
              <ul>
                <li>
                  <strong>{lastSocialAction.platform ?? "social"}</strong>
                  <span className="muted"> · {lastSocialAction.action ?? "-"} · {lastSocialAction.status ?? "-"}</span>
                  {lastSocialAction.postedAt ? <span className="muted"> · {formatTimestamp(lastSocialAction.postedAt)}</span> : null}
                  {lastSocialAction.url ? (
                    <> · <a href={lastSocialAction.url} target="_blank" rel="noreferrer">{lastSocialAction.url}</a></>
                  ) : null}
                </li>
              </ul>
            </div>
          ) : null}

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

          <div className="song-detail-resources">
            <div className="muted">Local files</div>
            <ul>
              {briefPath ? <li><code>{briefPath}</code></li> : null}
              <li><code>{lyricsPath}</code></li>
              <li><code>{songPath}</code></li>
            </ul>
          </div>

          <details className="song-detail-section" open>
            <summary><strong>Events</strong> <span className="muted">({events.length})</span></summary>
            {events.length === 0 ? (
              <div className="item muted">No events recorded.</div>
            ) : (
              <ul className="song-detail-events-list">
                {events.map((event) => (
                  <li key={eventKey(event)}>
                    <span className="song-detail-event-time">{formatTimestamp(event.timestamp)}</span>
                    <span className="song-detail-event-type"> · {event.type}</span>
                    {event.reason ? <span className="muted"> · {event.reason}</span> : null}
                    {event.selectedTakeId ? <span className="muted"> · {event.selectedTakeId}</span> : null}
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
          </details>
        </>
      )}
    </article>
  );
}
