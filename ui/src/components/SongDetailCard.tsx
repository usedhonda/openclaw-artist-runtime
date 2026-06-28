import React, { useEffect, useMemo, useState } from "react";
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
  cascadeTrace?: CascadeTrace | null;
  lyrics?: string;
  songMarkdown?: string;
  promptLedger?: PromptLedgerEntry[];
  sunoRuns?: SunoRun[];
  selectedTake?: SelectedTake | unknown;
  takeSelections?: PromptLedgerEntry[];
  takeHistory?: TakeHistoryEntry[];
  socialAssets?: SocialAsset[];
  lastSocialAction?: SocialAction | null;
  latestPromptPack?: { version?: number | string; metadata?: { charCounts?: { style?: number; lyrics?: number; title?: number } } } | null;
};

type SongReviewActionResponse = {
  status?: string;
  message?: string;
  song?: SongState;
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

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
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

type CascadeTrace = {
  observationSources: Array<{
    label: string;
    author?: string;
    quote?: string;
    url?: string;
  }>;
  artistVoice: string;
  title: string;
  lyricsTheme: string;
  styleLayer: string;
};

function pickBriefField(brief: string | undefined, label: string): string | undefined {
  if (!brief) return undefined;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return brief.match(new RegExp(`^-\\s*${escaped}:\\s*(.+)$`, "im"))?.[1]?.trim();
}

function compactTrace(value: string | undefined, fallback: string, limit = 120): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function buildSongCascadeTrace(detail: SongDetailResponse | null, songId: string): CascadeTrace | null {
  if (detail?.cascadeTrace) return detail.cascadeTrace;
  const song = detail?.song;
  if (!song && !detail?.brief) return null;
  const brief = detail?.brief ?? "";
  const url = brief.match(/https?:\/\/\S+/)?.[0]?.replace(/[)）\]、。,]+$/g, "");
  const quote = brief.match(/^- Quote:\s*(.+)$/im)?.[1]?.trim()
    ?? brief.match(/^- Source quote:\s*(.+)$/im)?.[1]?.trim()
    ?? song?.observationSummary;
  const artistVoice = song?.lastReason ?? detail?.takeHistory?.[0]?.reason ?? "(未記録)";
  return {
    observationSources: [{
      label: "brief source",
      quote: compactTrace(quote, "未記録", 140),
      url
    }],
    artistVoice: compactTrace(artistVoice, "未記録", 110),
    title: compactTrace(song?.title, songId, 80),
    lyricsTheme: compactTrace(pickBriefField(brief, "Lyrics theme") ?? pickBriefField(brief, "Core theme"), "未記録"),
    styleLayer: compactTrace(pickBriefField(brief, "Style notes"), "未記録")
  };
}

export interface SongDetailCardProps {
  songId: string;
  onBack: () => void;
  eventStreamUrl?: string;
}

export function ProducerReviewButtons(props: {
  disabled?: boolean;
  onArchive: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="inline-actions song-detail-review-actions">
      <button
        type="button"
        disabled={props.disabled}
        onClick={props.onArchive}
      >
        採用
      </button>
      <button
        type="button"
        disabled={props.disabled}
        onClick={props.onDiscard}
      >
        破棄
      </button>
    </div>
  );
}

export function SongDetailCard(props: SongDetailCardProps) {
  const { songId, onBack } = props;
  const [detail, setDetail] = useState<SongDetailResponse | null>(null);
  const [events, setEvents] = useState<RuntimeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sunoHandoffBusy, setSunoHandoffBusy] = useState(false);
  const [sunoHandoffError, setSunoHandoffError] = useState<string | null>(null);
  const [sunoHandoffResult, setSunoHandoffResult] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState<"archive" | "discard" | null>(null);
  const [reviewResult, setReviewResult] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const completeSunoHandoff = async () => {
    setSunoHandoffBusy(true);
    setSunoHandoffError(null);
    setSunoHandoffResult(null);
    try {
      const res = await postJson<{ state?: string; connected?: boolean }>("/suno/handoff/complete");
      setSunoHandoffResult(`state=${res.state ?? "-"} · connected=${res.connected ? "true" : "false"}`);
    } catch (err) {
      setSunoHandoffError(err instanceof Error ? err.message : String(err));
    } finally {
      setSunoHandoffBusy(false);
    }
  };

  const reloadDetail = async () => {
    const [detailRes, eventsRes] = await Promise.all([
      fetchJson<SongDetailResponse>(`/songs/${encodeURIComponent(songId)}`),
      fetchJson<SongEventsResponse>(`/songs/${encodeURIComponent(songId)}/events?limit=200`).catch(() => ({ events: [] }))
    ]);
    setDetail(detailRes);
    setEvents([...(eventsRes.events ?? [])].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)));
  };

  const runProducerReviewAction = async (action: "archive" | "discard") => {
    setReviewBusy(action);
    setReviewError(null);
    setReviewResult(null);
    try {
      const res = await postJson<SongReviewActionResponse>(`/songs/${encodeURIComponent(songId)}/${action}`);
      setReviewResult(res.message ?? `status=${res.song?.status ?? res.status ?? "-"}`);
      await reloadDetail();
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setReviewBusy(null);
    }
  };

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
  const canReviewSelectedTake = song?.status === "take_selected";
  const cascadeTrace = useMemo(() => buildSongCascadeTrace(detail, songId), [detail, songId]);
  const cascadeSource = cascadeTrace?.observationSources[0];

  return (
    <article className="panel song-detail-card">
      <div className="song-detail-header">
        <Breadcrumb
          segments={[
            { label: "作品", onClick: onBack },
            { label: title }
          ]}
        />
        <button type="button" className="song-detail-back" onClick={onBack}>&larr; 作品へ</button>
        <div className="song-detail-title-row">
          <strong>{title}</strong>
          <span className="muted">{songId}</span>
        </div>
      </div>

      {loading ? (
        <div className="item muted">曲の詳細を読み込み中。</div>
      ) : error ? (
        <div className="item muted">読み込めませんでした: {error}</div>
      ) : !song ? (
        <div className="item muted">曲が見つかりません。</div>
      ) : (
        <>
          <dl className="song-detail-status">
            <div><dt>状態</dt><dd>{song.status ?? "-"}</dd></div>
            <div><dt>歌詞</dt><dd>v{song.lyricsVersion ?? "-"}</dd></div>
            <div><dt>制作回数</dt><dd>{song.runCount ?? 0}</dd></div>
            <div><dt>選ばれた take</dt><dd>{song.selectedTake || "-"}</dd></div>
            <div><dt>更新</dt><dd>{formatTimestamp(song.updatedAt)}</dd></div>
            <div><dt>歌詞エラー</dt><dd>{song.degradedLyrics ? "あり" : "なし"}</dd></div>
          </dl>

          <div className="item song-detail-suno-handoff">
            <div className="muted">Suno 接続</div>
            <button
              type="button"
              className="link-button"
              disabled={sunoHandoffBusy}
              onClick={() => void completeSunoHandoff()}
            >
              Suno ログイン済を記録
            </button>
            <div className="muted">
              scripts/openclaw-suno-login.mjs でログインした後に押す
            </div>
            {sunoHandoffResult ? <div className="muted">{sunoHandoffResult}</div> : null}
            {sunoHandoffError ? <div className="muted">error: {sunoHandoffError}</div> : null}
          </div>

          {song.lastReason ? (
            <div className="item song-detail-reason">
              <div className="muted">最後の理由</div>
              <div>{song.lastReason}</div>
            </div>
          ) : null}

          {song.observationSummary ? (
            <div className="item song-detail-reason">
              <div className="muted">観察の要約</div>
              <div>{song.observationSummary}</div>
            </div>
          ) : null}

          {cascadeTrace ? (
            <div className="item song-detail-reason">
              <div className="muted">制作の流れ</div>
              <dl className="song-detail-status">
                <div><dt>観察 source</dt><dd>{cascadeSource?.url ? <a href={cascadeSource.url} target="_blank" rel="noreferrer">{cascadeSource.quote ?? cascadeSource.label}</a> : cascadeSource?.quote ?? cascadeSource?.label ?? "未記録"}</dd></div>
                <div><dt>アーティストの声</dt><dd>{cascadeTrace.artistVoice}</dd></div>
                <div><dt>title</dt><dd>{cascadeTrace.title}</dd></div>
                <div><dt>歌詞テーマ</dt><dd>{cascadeTrace.lyricsTheme}</dd></div>
                <div><dt>音の方向</dt><dd>{cascadeTrace.styleLayer}</dd></div>
              </dl>
            </div>
          ) : null}

          <details className="song-detail-section" open>
            <summary><strong>曲の設計</strong> <span className="muted">({(detail?.brief ?? "").length} 字)</span></summary>
            <pre className="song-detail-pre">{detail?.brief || "(no brief)"}</pre>
          </details>

          <details className="song-detail-section">
            <summary><strong>歌詞</strong> <span className="muted">({(detail?.lyrics ?? "").length} 字)</span></summary>
            <pre className="song-detail-pre">{detail?.lyrics || "(no lyrics)"}</pre>
          </details>

          <details className="song-detail-section">
            <summary><strong>song.md</strong> <span className="muted">({(detail?.songMarkdown ?? "").length} chars)</span></summary>
            <pre className="song-detail-pre">{detail?.songMarkdown || "(no song.md)"}</pre>
          </details>

          <details className="song-detail-section" open>
            <summary><strong>Suno 制作</strong> <span className="muted">({sunoRuns.length})</span></summary>
            {sunoRuns.length === 0 ? (
              <div className="item muted">まだ制作記録はありません。</div>
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
            <summary><strong>選ばれた take</strong></summary>
            {selectedTake ? (
              <>
                <dl className="song-detail-status">
                  <div><dt>Take ID</dt><dd>{selectedTake.selectedTakeId ?? "-"}</dd></div>
                  <div><dt>Run</dt><dd>{selectedTake.runId ?? "-"}</dd></div>
                  <div><dt>理由</dt><dd>{selectedTake.reason ?? "-"}</dd></div>
                  <div><dt>選択日時</dt><dd>{formatTimestamp(selectedTake.timestamp)}</dd></div>
                  {selectedTake.url ? <div><dt>URL</dt><dd><a href={selectedTake.url} target="_blank" rel="noreferrer">{selectedTake.url}</a></dd></div> : null}
                </dl>
                {canReviewSelectedTake ? (
                  <ProducerReviewButtons
                    disabled={reviewBusy !== null}
                    onArchive={() => void runProducerReviewAction("archive")}
                    onDiscard={() => void runProducerReviewAction("discard")}
                  />
                ) : null}
                {reviewResult ? <div className="muted">{reviewResult}</div> : null}
                {reviewError ? <div className="muted">error: {reviewError}</div> : null}
              </>
            ) : (
              <div className="item muted">まだ take は選ばれていません。</div>
            )}
          </details>

          <details className="song-detail-section">
            <summary><strong>take の履歴</strong> <span className="muted">({takeHistory.length})</span></summary>
            {takeHistory.length === 0 ? (
              <div className="item muted">過去の選択はありません。</div>
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
            <summary><strong>プロンプト台帳</strong> <span className="muted">({promptLedger.length})</span></summary>
            {promptLedger.length === 0 ? (
              <div className="item muted">プロンプト記録はまだありません。</div>
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
              {detail.latestPromptPack.metadata?.charCounts ? (
                <div className="muted">
                  style {detail.latestPromptPack.metadata.charCounts.style ?? "-"}字 / lyrics {detail.latestPromptPack.metadata.charCounts.lyrics ?? "-"}字 / title {detail.latestPromptPack.metadata.charCounts.title ?? "-"}字
                </div>
              ) : null}
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
