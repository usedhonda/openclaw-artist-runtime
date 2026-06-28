import React, { Suspense, useEffect, useRef, useState } from "react";
import { buildConfigDraft, buildConfigUpdatePatch, validateConfigDraft, type ConfigDraft, type ConfigEditorSource } from "./configEditor";
import { ErrorToastStack } from "./ErrorToast";
import { AwaitingDecisionPanel, groupAwaitingDecisions, type AwaitingDecision } from "./components/AwaitingDecisionPanel";
import { SongDetailCard } from "./components/SongDetailCard";
import { SongLifecycleTimelineCard } from "./components/SongLifecycleTimelineCard";
import { SpawnProposalQueuePanel, type SpawnProposalQueueItem } from "./components/SpawnProposalQueuePanel";
import { SetupView } from "./components/SetupView";
import { useHashRoute } from "./hooks/useHashRoute";
import {
  buildPersonaArtistPatch,
  buildPersonaDraft,
  buildPersonaSnapshotPatch,
  buildPersonaSoulPatch,
  validatePersonaDraft,
  type ArtistPersonaDraft,
  type PersonaDraft,
  type PersonaDraftLayer,
  type PersonaEditorSource,
  type SoulPersonaDraft
} from "./personaEditor";
import { dismissErrorToast, expireErrorToasts, pushErrorToast, type ErrorToast, type ErrorToastSource } from "../../src/services/errorToastQueue";
import {
  instagramAuthorityModes,
  sunoDriverModes,
  sunoSubmitModes,
  tiktokAuthorityModes,
  xAuthorityModes,
  type DraftBoxNextActionSummary,
  type PersonaField
} from "../../src/types";

const refreshIntervalMs = 5000;
const apiBase = "/plugins/artist-runtime/api";
const fetchTimeoutMs = 10_000;
const LegacyConsole = React.lazy(() => import("./App").then((module) => ({ default: module.App })));

type RoomView = "room" | "songs" | "settings" | "setup" | "diagnostics";

type StatusResponse = {
  autopilot: {
    stage: string;
    nextAction: string;
    nextActionSummary?: DraftBoxNextActionSummary;
    currentRunId?: string;
    currentSongId?: string;
    blockedReason?: string | null;
    lastError?: string | null;
  };
  ticker?: {
    lastOutcome?: string;
    lastTickAt?: string;
    intervalMs?: number;
  };
  recentSong?: {
    songId: string;
    title: string;
    status: string;
  };
};

type ConfigResponse = ConfigEditorSource & {
  artist: {
    artistId: string;
    workspaceRoot: string;
    identity?: {
      displayName?: string;
      producerCallname?: string;
    };
  };
};

type SongSummary = {
  songId: string;
  title: string;
  status: string;
  runCount: number;
  selectedTakeId?: string;
};

type CallbackActionsResponse = {
  count: number;
  callbacks: AwaitingDecision[];
};

type SpawnProposalsResponse = {
  count: number;
  proposals: SpawnProposalQueueItem[];
};

type PersonaProposeResponse = {
  drafts?: Array<{ field: PersonaField; draft: string; status: "proposed" | "skipped" | "low_confidence"; reasoning?: string }>;
  warnings?: string[];
  provider?: string;
  error?: string;
};

type PersonaDirtyMap = Record<PersonaDraftLayer, boolean>;

const emptyPersonaDirty: PersonaDirtyMap = {
  artist: false,
  soul: false,
  identity: false,
  producer: false,
  inner: false
};

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), fetchTimeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetchWithTimeout(`${apiBase}${path}`);
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function apiPost<T>(path: string, body: unknown = {}): Promise<T> {
  const response = await fetchWithTimeout(`${apiBase}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function viewFromHash(hash: string): RoomView {
  if (hash === "#songs") return "songs";
  if (hash.startsWith("#song=")) return "songs";
  if (hash === "#settings") return "settings";
  if (hash === "#setup") return "setup";
  if (hash === "#diagnostics") return "diagnostics";
  return "room";
}

function useRoomView(): RoomView {
  const [view, setView] = useState<RoomView>(() => viewFromHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setView(viewFromHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return view;
}

function fallbackSummary(status: StatusResponse | null): DraftBoxNextActionSummary {
  return {
    kind: "empty",
    currentLine: status ? `今: ${status.autopilot.stage}` : "今: 状況を読み込んでいる",
    draftCount: 0,
    buildingCount: status?.autopilot.currentSongId ? 1 : 0,
    nextAction: status?.autopilot.nextAction ?? "次: 状況取得を待つ。",
    stateKey: status?.autopilot.stage ?? "loading",
    songId: status?.autopilot.currentSongId,
    reason: status?.autopilot.blockedReason ?? status?.autopilot.lastError ?? undefined
  };
}

function statusLabel(kind: DraftBoxNextActionSummary["kind"]): string {
  switch (kind) {
    case "decision_pending":
      return "判断待ち";
    case "hard_stop":
      return "hard stop";
    case "paused":
    case "suno_trouble":
      return "詰まり";
    case "reauth_required":
      return "要再認証";
    case "building":
    case "draft_idle":
    case "empty":
    default:
      return "健康";
  }
}

function showsWhy(kind: DraftBoxNextActionSummary["kind"]): boolean {
  return kind === "decision_pending" || kind === "hard_stop" || kind === "paused" || kind === "reauth_required" || kind === "suno_trouble";
}

function canLine(summary: DraftBoxNextActionSummary): string {
  switch (summary.kind) {
    case "decision_pending":
      return summary.nextAction;
    case "reauth_required":
      return "歌詞AIの再認証が必要 (/resume では直りません)";
    case "hard_stop":
      return "/status で理由を確認";
    case "suno_trouble":
      return "Suno 接続が戻れば自動で続く";
    case "paused":
      return "Resume";
    case "building":
    case "draft_idle":
    case "empty":
    default:
      return "Nothing needed — 次の曲を構想中";
  }
}

export function roomSummaryWithDecisions(summary: DraftBoxNextActionSummary, awaitingDecisions: CallbackActionsResponse): DraftBoxNextActionSummary {
  if (awaitingDecisions.count <= 0 || awaitingDecisions.callbacks.length === 0) return summary;
  const [latest] = groupAwaitingDecisions(awaitingDecisions.callbacks);
  if (!latest) return summary;
  const target = latest.songTitle ?? latest.songId ?? latest.proposalId ?? "曲";
  return {
    ...summary,
    kind: "decision_pending",
    currentLine: `今: ${target} の判断待ち`,
    nextAction: `次: Telegram の最新通知で ${latest.actions.join(" / ")} を選ぶ`,
    reason: `${latest.stage ?? "stage 不明"} · 最新の producer decision`,
    stateKey: `decision_pending:${latest.songId ?? latest.proposalId ?? latest.callbackId}`
  };
}

export function RoomHeader(props: {
  summary: DraftBoxNextActionSummary;
  onResume?: () => void;
  resumeBusy?: boolean;
}) {
  const { summary } = props;
  const why = showsWhy(summary.kind) ? summary.reason : undefined;

  return (
    <article className={`panel room-status-card room-status-${summary.kind}`}>
      <div className="eyebrow">Producer Room</div>
      <h1>Room</h1>
      <div className="room-grammar">
        <div>
          <span className="grammar-label">Artist is:</span>
          <strong>{summary.currentLine}</strong>
        </div>
        <div>
          <span className="grammar-label">Status:</span>
          <strong>{statusLabel(summary.kind)}</strong>
        </div>
        {why ? (
          <div>
            <span className="grammar-label">Why:</span>
            <span>{why}</span>
          </div>
        ) : null}
        <div>
          <span className="grammar-label">You can:</span>
          {summary.kind === "paused" ? (
            <button type="button" className="primary" disabled={props.resumeBusy} onClick={props.onResume}>
              {props.resumeBusy ? "Resuming..." : "Resume"}
            </button>
          ) : (
            <span>{canLine(summary)}</span>
          )}
        </div>
      </div>
    </article>
  );
}

function RouteNav(props: { activeView: RoomView }) {
  const linkClass = (view: RoomView) => `tab-button${props.activeView === view ? " is-active" : ""}`;
  return (
    <nav className="view-tabs producer-room-tabs" aria-label="Producer Room views">
      <a className={linkClass("room")} href="#room">Room</a>
      <a className={linkClass("songs")} href="#songs">Songs</a>
      <a className={linkClass("setup")} href="#setup">Setup</a>
      <a className={linkClass("settings")} href="#settings">Settings</a>
      <a className="producer-room-diagnostics-link" href="#diagnostics">診断</a>
    </nav>
  );
}

function RoomViewPanel(props: {
  status: StatusResponse | null;
  summary: DraftBoxNextActionSummary;
  awaitingDecisions: CallbackActionsResponse;
  spawnProposalQueue: SpawnProposalsResponse;
  persona: PersonaEditorSource | null;
  busy: string | null;
  selectedSongId: string | null;
  onResume: () => void;
  onPromptPackGo: (songId: string) => void;
  onDecideSpawnProposal: (proposalId: string, decision: "inject" | "skip") => void;
}) {
  return (
    <section className="single-column producer-room-grid">
      <RoomHeader summary={roomSummaryWithDecisions(props.summary, props.awaitingDecisions)} onResume={props.onResume} resumeBusy={props.busy === "resume"} />
      {props.persona?.setup.needsSetup ? (
        <article className="panel">
          <div className="warning-banner">
            Setup が未完了です: {props.persona.setup.reasonsText} <a href="#setup">Setup を開く</a>
          </div>
        </article>
      ) : null}
      <article className="panel room-note-card">
        <div className="section-title">Creative Milestones</div>
        <div className="muted">操作の主役は Telegram。Console は現在地と判断待ちの mirror です。</div>
        {props.selectedSongId ? <div className="muted">選択中 song: {props.selectedSongId}</div> : null}
      </article>
      <SongLifecycleTimelineCard />
      <SpawnProposalQueuePanel
        count={props.spawnProposalQueue.count}
        proposals={props.spawnProposalQueue.proposals}
        onDecide={props.onDecideSpawnProposal}
        busyKey={props.busy}
      />
      <AwaitingDecisionPanel
        callbacks={props.awaitingDecisions.callbacks}
        count={props.awaitingDecisions.count}
        maxGroups={1}
        onPromptPackGo={props.onPromptPackGo}
        busyKey={props.busy}
      />
    </section>
  );
}

function StatusPill(props: { status: string }) {
  return <span className={`status-pill status-pill-${props.status.replace(/[^A-Za-z0-9_-]/g, "_")}`}>{props.status}</span>;
}

export function SongsView(props: {
  songs: SongSummary[];
  selectedSongId: string | null;
  onSelectSong: (songId: string) => void;
  onBack: () => void;
}) {
  const selected = props.selectedSongId;
  return (
    <section className="single-column songs-view">
      <article className="panel">
        <div className="section-title">Songs</div>
        <div className="muted">採用/破棄は Telegram の通知から。Console は作品の歩みを読む mirror です。</div>
        {props.songs.length === 0 ? (
          <div className="item muted">曲台帳はまだ空です。</div>
        ) : (
          <div className="song-ledger-list">
            {props.songs.map((song) => (
              <button
                type="button"
                className={`song-ledger-row${selected === song.songId ? " is-selected" : ""}`}
                key={song.songId}
                onClick={() => props.onSelectSong(song.songId)}
              >
                <span>
                  <strong>{song.title || song.songId}</strong>
                  <span className="muted">{song.songId} · run {song.runCount}</span>
                </span>
                <span>
                  <StatusPill status={song.status} />
                  {song.selectedTakeId ? <span className="muted">take {song.selectedTakeId}</span> : null}
                </span>
              </button>
            ))}
          </div>
        )}
      </article>
      {selected ? <SongDetailCard key={selected} songId={selected} onBack={props.onBack} /> : null}
      <SongLifecycleTimelineCard />
    </section>
  );
}

function NumberField(props: {
  label: string;
  value: string;
  min: number;
  max: number;
  onChange: (value: string) => void;
  note?: string;
}) {
  return (
    <label>
      <div className="eyebrow">{props.label}</div>
      <input type="number" min={props.min} max={props.max} step={1} value={props.value} onChange={(event) => props.onChange(event.target.value)} />
      {props.note ? <div className="muted">{props.note}</div> : null}
    </label>
  );
}

export function SettingsView(props: {
  config: ConfigResponse | null;
  draft: ConfigDraft | null;
  dirty: boolean;
  busy: boolean;
  validationError: string | null;
  onUpdateDraft: (update: Partial<ConfigDraft>) => void;
  onSave: () => void;
  onReset: () => void;
  onRefresh: () => void;
}) {
  const draft = props.draft;
  const globalArmHeld = Boolean(draft && !draft.distributionLiveGoArmed);

  return (
    <section className="single-column settings-view">
      <article className="panel settings-panel">
        <div className="section-title">Settings</div>
        <div className="muted">platform / authority / budget / cadence / hard-stop を steer する場所です。</div>
        {!props.config || !draft ? (
          <div className="item muted">Loading config.</div>
        ) : (
          <div className="settings-sections">
            <section className="settings-section">
              <div className="section-title">Autopilot</div>
              <label className="toggle"><input type="checkbox" checked={draft.autopilotEnabled} onChange={(event) => props.onUpdateDraft({ autopilotEnabled: event.target.checked })} />Autopilot enabled</label>
              <label className="toggle"><input type="checkbox" checked={draft.dryRun} onChange={(event) => props.onUpdateDraft({ dryRun: event.target.checked })} />Dry-run safety</label>
              <label className="toggle"><input type="checkbox" checked={draft.distributionLiveGoArmed} onChange={(event) => props.onUpdateDraft({ distributionLiveGoArmed: event.target.checked })} />Live-Go Arm (global)</label>
              {globalArmHeld ? <div className="warning-banner">Global live-go arm is OFF. Platform arms stay held upstream.</div> : null}
              <div className="field-grid">
                <NumberField label="Songs Per Week" value={draft.songsPerWeek} min={0} max={21} onChange={(value) => props.onUpdateDraft({ songsPerWeek: value })} />
                <NumberField label="Cycle Interval Minutes" value={draft.cycleIntervalMinutes} min={15} max={1440} onChange={(value) => props.onUpdateDraft({ cycleIntervalMinutes: value })} />
              </div>
            </section>
            <section className="settings-section">
              <div className="section-title">Suno Budget</div>
              <div className="field-grid">
                <NumberField label="Daily Credit Limit" value={draft.dailyCreditLimit} min={1} max={1000} onChange={(value) => props.onUpdateDraft({ dailyCreditLimit: value })} />
                <NumberField label="Monthly Credit Limit" value={draft.monthlyCreditLimit} min={0} max={50000} onChange={(value) => props.onUpdateDraft({ monthlyCreditLimit: value })} note="0 means unlimited." />
                <label>
                  <div className="eyebrow">Suno Driver</div>
                  <select value={draft.sunoDriver} onChange={(event) => props.onUpdateDraft({ sunoDriver: event.target.value as ConfigDraft["sunoDriver"] })}>
                    {sunoDriverModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                  </select>
                </label>
                <label>
                  <div className="eyebrow">Suno Submit Mode</div>
                  <select value={draft.sunoSubmitMode} onChange={(event) => props.onUpdateDraft({ sunoSubmitMode: event.target.value as ConfigDraft["sunoSubmitMode"] })}>
                    {sunoSubmitModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                  </select>
                  {draft.sunoSubmitMode === "live" ? <div className="warning-banner">Live submit consumes real Suno credits.</div> : <div className="muted">skip = no Create click, live = real submit.</div>}
                </label>
              </div>
            </section>
            <section className="settings-section">
              <div className="section-title">Platforms</div>
              <div className="field-grid">
                <label className={`platform-config${globalArmHeld ? " is-held" : ""}`}>
                  <div className="toggle"><input type="checkbox" checked={draft.xEnabled} onChange={(event) => props.onUpdateDraft({ xEnabled: event.target.checked })} />X enabled</div>
                  <div className="toggle"><input type="checkbox" checked={draft.xLiveGoArmed} onChange={(event) => props.onUpdateDraft({ xLiveGoArmed: event.target.checked })} />X live-go arm</div>
                  <div className="eyebrow">X Authority</div>
                  <select value={draft.xAuthority} onChange={(event) => props.onUpdateDraft({ xAuthority: event.target.value as ConfigDraft["xAuthority"] })}>
                    {xAuthorityModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                  </select>
                </label>
                <label className="platform-config is-frozen" title="凍結中">
                  <div className="toggle"><input type="checkbox" checked={draft.instagramEnabled} onChange={(event) => props.onUpdateDraft({ instagramEnabled: event.target.checked })} />Instagram enabled</div>
                  <div className="toggle"><input type="checkbox" checked={draft.instagramLiveGoArmed} disabled readOnly />Instagram live-go arm <span className="badge badge-frozen">frozen</span></div>
                  <div className="eyebrow">Instagram Authority</div>
                  <select value={draft.instagramAuthority} onChange={(event) => props.onUpdateDraft({ instagramAuthority: event.target.value as ConfigDraft["instagramAuthority"] })}>
                    {instagramAuthorityModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                  </select>
                  <div className="muted">Instagram is frozen until operator review.</div>
                </label>
                <label className="platform-config is-frozen" title="アカウント未作成 / 凍結中">
                  <div className="toggle"><input type="checkbox" checked={draft.tiktokEnabled} onChange={(event) => props.onUpdateDraft({ tiktokEnabled: event.target.checked })} />TikTok enabled</div>
                  <div className="toggle"><input type="checkbox" checked={draft.tiktokLiveGoArmed} disabled readOnly />TikTok live-go arm <span className="badge badge-frozen">frozen</span></div>
                  <div className="eyebrow">TikTok Authority</div>
                  <select value={draft.tiktokAuthority} onChange={(event) => props.onUpdateDraft({ tiktokAuthority: event.target.value as ConfigDraft["tiktokAuthority"] })}>
                    {tiktokAuthorityModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                  </select>
                  <div className="muted">TikTok stays frozen until the operator account exists.</div>
                </label>
              </div>
            </section>
            <div className="muted">artist {props.config.artist.artistId} · workspace configured</div>
            {props.validationError ? <div className="field-error">{props.validationError}</div> : null}
            <div className="inline-actions">
              <button className="primary" type="button" disabled={props.busy || Boolean(props.validationError)} onClick={props.onSave}>Save Settings</button>
              <button type="button" disabled={props.busy || !props.dirty} onClick={props.onReset}>Reset Draft</button>
              <button type="button" disabled={props.busy} onClick={props.onRefresh}>Refresh</button>
            </div>
          </div>
        )}
      </article>
    </section>
  );
}

export function DiagnosticsView() {
  return (
    <section className="single-column">
      <article className="panel">
        <div className="section-title">診断</div>
        <p>旧 Console を診断用に読み込みます。Room / Songs / Settings には内部操作の主導ボタンを戻しません。</p>
        <Suspense fallback={<div className="item muted">旧 Console を読み込み中。</div>}>
          <LegacyConsole />
        </Suspense>
      </article>
    </section>
  );
}

export function ProducerRoomApp() {
  const activeView = useRoomView();
  const { selectedSongId, clearSong, selectSong } = useHashRoute();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [configDraft, setConfigDraft] = useState<ConfigDraft | null>(null);
  const [configDirty, setConfigDirty] = useState(false);
  const configDirtyRef = useRef(false);
  const [persona, setPersona] = useState<PersonaEditorSource | null>(null);
  const [personaDraft, setPersonaDraft] = useState<PersonaDraft | null>(null);
  const [personaDirty, setPersonaDirty] = useState<PersonaDirtyMap>(emptyPersonaDirty);
  const personaDirtyRef = useRef(false);
  const [songs, setSongs] = useState<SongSummary[]>([]);
  const [awaitingDecisions, setAwaitingDecisions] = useState<CallbackActionsResponse>({ count: 0, callbacks: [] });
  const [spawnProposalQueue, setSpawnProposalQueue] = useState<SpawnProposalsResponse>({ count: 0, proposals: [] });
  const [busy, setBusy] = useState<string | null>(null);
  const [errorToasts, setErrorToasts] = useState<ErrorToast[]>([]);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);

  const showErrorToast = (source: ErrorToastSource, reason: string, message: string) => {
    setErrorToasts((current) => pushErrorToast(current, { source, reason, message }, Date.now()));
  };

  const refresh = async () => {
    try {
      const [nextStatus, nextSongs, nextConfig, nextPersona, nextAwaitingDecisions, nextSpawnProposalQueue] = await Promise.all([
        apiGet<StatusResponse>("/status"),
        apiGet<SongSummary[]>("/songs"),
        apiGet<ConfigResponse>("/config"),
        apiGet<PersonaEditorSource>("/persona"),
        apiGet<CallbackActionsResponse>("/callback-actions?status=pending&category=producer_decision"),
        apiGet<SpawnProposalsResponse>("/spawn-proposals?status=draft&limit=20")
      ]);
      setStatus(nextStatus);
      setSongs(nextSongs);
      setConfig(nextConfig);
      setPersona(nextPersona);
      if (!configDirtyRef.current) {
        setConfigDraft(buildConfigDraft(nextConfig));
      }
      if (!personaDirtyRef.current) {
        setPersonaDraft(buildPersonaDraft(nextPersona));
      }
      setAwaitingDecisions(nextAwaitingDecisions);
      setSpawnProposalQueue(nextSpawnProposalQueue);
      setLastRefreshAt(Date.now());
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
      showErrorToast("network", "refresh_failed", message);
    }
  };

  useEffect(() => {
    void refresh();
    const intervalId = window.setInterval(() => void refresh(), refreshIntervalMs);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setErrorToasts((current) => expireErrorToasts(current, Date.now()));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  const resumeAutopilot = async () => {
    setBusy("resume");
    try {
      await apiPost("/resume");
      await refresh();
      showErrorToast("runtime", "resume_requested", "autopilot resume を送信しました。");
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
      showErrorToast("runtime", "resume_failed", message);
    } finally {
      setBusy(null);
    }
  };

  const decideSpawnProposal = async (proposalId: string, decision: "inject" | "skip") => {
    setBusy(`spawn-${decision}:${proposalId}`);
    try {
      await apiPost(`/spawn-proposals/${encodeURIComponent(proposalId)}/${decision}`);
      await refresh();
      showErrorToast("runtime", `spawn_${decision}_applied`, decision === "inject" ? "曲づくりを開始しました。" : "草稿を見送りました。");
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
      showErrorToast("runtime", `spawn_${decision}_failed`, message);
    } finally {
      setBusy(null);
    }
  };

  const goPromptPack = async (songId: string) => {
    setBusy(`prompt-pack-go:${songId}`);
    try {
      await apiPost(`/songs/${encodeURIComponent(songId)}/prompt-pack-go`);
      await refresh();
      showErrorToast("runtime", "prompt_pack_go_applied", "Suno 生成へ進めました。");
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
      showErrorToast("runtime", "prompt_pack_go_failed", message);
    } finally {
      setBusy(null);
    }
  };

  const updateConfigDraft = (update: Partial<ConfigDraft>) => {
    configDirtyRef.current = true;
    setConfigDirty(true);
    setConfigDraft((current) => current ? { ...current, ...update } : current);
  };

  const resetConfigDraft = () => {
    if (!config) {
      return;
    }
    configDirtyRef.current = false;
    setConfigDirty(false);
    setConfigDraft(buildConfigDraft(config));
  };

  const saveConfig = async () => {
    if (!configDraft) {
      return;
    }
    const validationError = validateConfigDraft(configDraft);
    if (validationError) {
      showErrorToast("config-patch", "config_validation_failed", validationError);
      return;
    }
    setBusy("config");
    try {
      await apiPost("/config/update", {
        patch: buildConfigUpdatePatch(configDraft)
      });
      configDirtyRef.current = false;
      setConfigDirty(false);
      await refresh();
      showErrorToast("config-patch", "config_updated", "Settings updated.");
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
      showErrorToast("config-patch", "config_update_failed", message);
    } finally {
      setBusy(null);
    }
  };

  const markPersonaDirty = (layer: PersonaDraftLayer, dirty: boolean) => {
    setPersonaDirty((current) => {
      const next = { ...current, [layer]: dirty };
      personaDirtyRef.current = Object.values(next).some(Boolean);
      return next;
    });
  };

  const resetPersonaDraft = () => {
    if (!persona) {
      return;
    }
    personaDirtyRef.current = false;
    setPersonaDirty(emptyPersonaDirty);
    setPersonaDraft(buildPersonaDraft(persona));
  };

  const updateArtistPersonaDraft = (field: keyof ArtistPersonaDraft, value: string) => {
    markPersonaDirty("artist", true);
    setPersonaDraft((current) => current ? { ...current, artist: { ...current.artist, [field]: value } } : current);
  };

  const updateSoulPersonaDraft = (field: keyof SoulPersonaDraft, value: string) => {
    markPersonaDirty("soul", true);
    setPersonaDraft((current) => current ? { ...current, soul: { ...current.soul, [field]: value } } : current);
  };

  const updateSnapshotPersonaDraft = (layer: "identity" | "producer" | "inner", value: string) => {
    markPersonaDirty(layer, true);
    setPersonaDraft((current) => current ? { ...current, snapshots: { ...current.snapshots, [layer]: value } } : current);
  };

  const savePersonaLayer = async (layer: PersonaDraftLayer) => {
    if (!personaDraft) {
      return;
    }
    const validationError = validatePersonaDraft(personaDraft, layer);
    if (validationError) {
      showErrorToast("config-patch", "persona_validation_failed", validationError);
      return;
    }
    const patch = layer === "artist"
      ? buildPersonaArtistPatch(personaDraft)
      : layer === "soul"
        ? buildPersonaSoulPatch(personaDraft)
        : buildPersonaSnapshotPatch(personaDraft, layer);
    setBusy(`persona-save:${layer}`);
    try {
      const response = await apiPost<{ error?: string }>(`/persona/${layer}`, patch);
      if (response.error) {
        throw new Error(response.error);
      }
      markPersonaDirty(layer, false);
      await refresh();
      showErrorToast("config-patch", `persona_${layer}_updated`, `${layer} updated.`);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
      showErrorToast("config-patch", `persona_${layer}_update_failed`, message);
    } finally {
      setBusy(null);
    }
  };

  const applyPersonaDraftProposal = (field: PersonaField, value: string) => {
    if (field === "soul-tone") {
      updateSoulPersonaDraft("conversationTone", value);
      return;
    }
    if (field === "soul-refusal") {
      updateSoulPersonaDraft("refusalStyle", value);
      return;
    }
    updateArtistPersonaDraft(field as keyof ArtistPersonaDraft, value);
  };

  const proposePersonaField = async (field: PersonaField) => {
    setBusy(`persona-ai:${field}`);
    try {
      const response = await apiPost<PersonaProposeResponse>("/persona/propose", { fields: [field] });
      if (response.error) {
        throw new Error(response.error);
      }
      const draft = response.drafts?.find((entry) => entry.field === field);
      if (!draft || draft.status !== "proposed") {
        showErrorToast("runtime", `persona_ai_${field}_skipped`, draft?.reasoning ?? "AI 下書きは返りませんでした。");
        return;
      }
      applyPersonaDraftProposal(field, draft.draft);
      const warning = response.warnings?.[0];
      showErrorToast("runtime", `persona_ai_${field}_proposed`, warning ? `AI下書き反映: ${warning}` : "AI下書きを反映しました。");
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
      showErrorToast("runtime", `persona_ai_${field}_failed`, message);
    } finally {
      setBusy(null);
    }
  };

  const completePersonaSetup = async () => {
    setBusy("persona-complete");
    try {
      const response = await apiPost<{ error?: string }>("/persona/complete");
      if (response.error) {
        throw new Error(response.error);
      }
      await refresh();
      showErrorToast("runtime", "persona_setup_complete", "Setup completion marker を記録しました。");
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
      showErrorToast("runtime", "persona_setup_complete_failed", message);
    } finally {
      setBusy(null);
    }
  };

  const summary = status?.autopilot.nextActionSummary ?? fallbackSummary(status);
  const configValidationError = configDraft ? validateConfigDraft(configDraft) : null;
  return (
    <main className="console-shell producer-room-shell">
      <header className="hero producer-room-hero">
        <div>
          <div className="eyebrow">Artist Runtime</div>
          <h1>Producer Room</h1>
          <div className="hero-copy">迷ったら、ここだけ見る。必要な操作は blocked 時に 1 つだけ出す。</div>
        </div>
        <div className="producer-room-refresh-pill">
          {lastRefreshAt ? `last refresh ${new Date(lastRefreshAt).toLocaleTimeString()}` : "status loading"}
        </div>
      </header>
      <RouteNav activeView={activeView} />
      {activeView === "room" ? (
        <RoomViewPanel
          status={status}
          summary={summary}
          awaitingDecisions={awaitingDecisions}
          spawnProposalQueue={spawnProposalQueue}
          persona={persona}
          busy={busy}
          selectedSongId={selectedSongId}
          onResume={resumeAutopilot}
          onPromptPackGo={goPromptPack}
          onDecideSpawnProposal={decideSpawnProposal}
        />
      ) : null}
      {activeView === "songs" ? (
        <SongsView songs={songs} selectedSongId={selectedSongId} onSelectSong={selectSong} onBack={clearSong} />
      ) : null}
      {activeView === "settings" ? (
        <SettingsView
          config={config}
          draft={configDraft}
          dirty={configDirty}
          busy={busy !== null}
          validationError={configValidationError}
          onUpdateDraft={updateConfigDraft}
          onSave={saveConfig}
          onReset={resetConfigDraft}
          onRefresh={refresh}
        />
      ) : null}
      {activeView === "setup" ? (
        <SetupView
          persona={persona}
          draft={personaDraft}
          dirty={personaDirty}
          busyKey={busy}
          onUpdateArtist={updateArtistPersonaDraft}
          onUpdateSoul={updateSoulPersonaDraft}
          onUpdateSnapshot={updateSnapshotPersonaDraft}
          onSaveLayer={savePersonaLayer}
          onReset={resetPersonaDraft}
          onRefresh={refresh}
          onPropose={proposePersonaField}
          onComplete={completePersonaSetup}
        />
      ) : null}
      {activeView === "diagnostics" ? <DiagnosticsView /> : null}
      <footer className="producer-room-closing-band">
        <strong>Quiet by default.</strong>
        <span>Creative milestones, hard stops, and one useful next action.</span>
      </footer>
      <ErrorToastStack toasts={errorToasts} onDismiss={(id) => setErrorToasts((current) => dismissErrorToast(current, id))} />
    </main>
  );
}
