import React, { useEffect, useRef, useState } from "react";
import { buildConfigDraft, buildConfigUpdatePatch, validateConfigDraft, type ConfigDraft, type ConfigEditorSource } from "./configEditor";
import { ErrorToastStack } from "./ErrorToast";
import { AwaitingDecisionPanel, groupAwaitingDecisions, type AwaitingDecision } from "./components/AwaitingDecisionPanel";
import { SongDetailCard } from "./components/SongDetailCard";
import { SpawnProposalQueuePanel, type SpawnProposalQueueItem } from "./components/SpawnProposalQueuePanel";
import { SetupView, type PersonaAiSuggestion } from "./components/SetupView";
import { useHashRoute } from "./hooks/useHashRoute";
import { resolveProducerRoomLocale, t, type ProducerRoomLocale } from "./i18n";
import {
  buildPersonaArtistPatch,
  buildPersonaDraft,
  buildPersonaSnapshotPatch,
  buildPersonaSoulPatch,
  emptyPersonaDraftFields,
  editablePersonaDraftFields,
  validatePersonaDraft,
  type ArtistPersonaDraft,
  type PersonaDraft,
  type PersonaDraftLayer,
  type PersonaEditorSource,
  type SoulPersonaDraft
} from "./personaEditor";
import { dismissErrorToast, expireErrorToasts, pushErrorToast, type ErrorToast, type ErrorToastSource } from "../../src/services/errorToastQueue";
import {
  xAuthorityModes,
  type DraftBoxNextActionSummary,
  type PersonaField
} from "../../src/types";

const refreshIntervalMs = 5000;
const apiBase = "/plugins/artist-runtime/api";
const fetchTimeoutMs = 10_000;
const songLedgerPageSize = 5;

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
    currentLine: status ? `Artist is: ${status.autopilot.stage}` : "Artist is: loading current state",
    draftCount: 0,
    buildingCount: status?.autopilot.currentSongId ? 1 : 0,
    nextAction: status?.autopilot.nextAction ?? "You can: wait for status refresh.",
    stateKey: status?.autopilot.stage ?? "loading",
    songId: status?.autopilot.currentSongId,
    reason: status?.autopilot.blockedReason ?? status?.autopilot.lastError ?? undefined
  };
}

function statusLabel(locale: ProducerRoomLocale, kind: DraftBoxNextActionSummary["kind"]): string {
  switch (kind) {
    case "decision_pending":
      return t(locale, "roomDecisionPending");
    case "hard_stop":
      return t(locale, "roomHardStop");
    case "paused":
    case "suno_trouble":
      return t(locale, "roomBlocked");
    case "reauth_required":
      return t(locale, "roomReauthRequired");
    case "building":
    case "draft_idle":
    case "empty":
    default:
      return t(locale, "roomHealthy");
  }
}

function showsWhy(kind: DraftBoxNextActionSummary["kind"]): boolean {
  return kind === "decision_pending" || kind === "hard_stop" || kind === "paused" || kind === "reauth_required" || kind === "suno_trouble";
}

function canLine(locale: ProducerRoomLocale, summary: DraftBoxNextActionSummary): string {
  switch (summary.kind) {
    case "decision_pending":
      return summary.nextAction;
    case "reauth_required":
      return t(locale, "roomReauthHelp");
    case "hard_stop":
      return t(locale, "roomHardStopHelp");
    case "suno_trouble":
      return t(locale, "roomSunoTroubleHelp");
    case "paused":
      return "Resume";
    case "building":
    case "draft_idle":
    case "empty":
    default:
      return t(locale, "roomNothingNeeded");
  }
}

function producerStageLabel(locale: ProducerRoomLocale, stage?: string): string {
  switch (stage) {
    case "asset_generation":
      return t(locale, "roomAwaitingAdoption");
    case "take_selected":
      return t(locale, "roomAwaitingAdoption");
    case "prompt_pack_ready":
      return t(locale, "roomAwaitingSunoGo");
    case "spawn_proposal_ready":
      return t(locale, "roomAwaitingIdeaDecision");
    default:
      return t(locale, "roomDecisionPending");
  }
}

export function roomSummaryWithDecisions(summary: DraftBoxNextActionSummary, awaitingDecisions: CallbackActionsResponse, locale: ProducerRoomLocale = "en"): DraftBoxNextActionSummary {
  if (awaitingDecisions.count <= 0 || awaitingDecisions.callbacks.length === 0) return summary;
  const [latest] = groupAwaitingDecisions(awaitingDecisions.callbacks);
  if (!latest) return summary;
  const target = latest.songTitle ?? latest.songId ?? latest.proposalId ?? "song";
  return {
    ...summary,
    kind: "decision_pending",
    currentLine: `Artist is: waiting on ${target}`,
    nextAction: `You can: choose ${latest.actions.join(" / ")} in the latest Telegram notice`,
    reason: producerStageLabel(locale, latest.stage),
    stateKey: `decision_pending:${latest.songId ?? latest.proposalId ?? latest.callbackId}`
  };
}

export function RoomHeader(props: {
  locale?: ProducerRoomLocale;
  summary: DraftBoxNextActionSummary;
  onResume?: () => void;
  resumeBusy?: boolean;
}) {
  const { summary } = props;
  const locale = props.locale ?? "en";
  const why = showsWhy(summary.kind) ? summary.reason : undefined;

  return (
    <article className={`panel room-status-card room-status-${summary.kind}`}>
      <div className="section-title">{t(locale, "roomCurrentState")}</div>
      <div className="room-grammar">
        <div>
          <span className="grammar-label">{t(locale, "roomArtistIs")}</span>
          <strong>{summary.currentLine}</strong>
        </div>
        <div>
          <span className="grammar-label">{t(locale, "roomStatus")}</span>
          <strong>{statusLabel(locale, summary.kind)}</strong>
        </div>
        {why ? (
          <div>
            <span className="grammar-label">{t(locale, "roomWhy")}</span>
            <span>{why}</span>
          </div>
        ) : null}
        <div>
          <span className="grammar-label">{t(locale, "roomYouCan")}</span>
          {summary.kind === "paused" ? (
            <button type="button" className="primary" disabled={props.resumeBusy} onClick={props.onResume}>
              {props.resumeBusy ? "Resuming..." : "Resume"}
            </button>
          ) : (
            <span>{canLine(locale, summary)}</span>
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
      <a className="producer-room-diagnostics-link" href="#diagnostics">Diagnostics</a>
    </nav>
  );
}

function RoomViewPanel(props: {
  locale: ProducerRoomLocale;
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
      <RoomHeader locale={props.locale} summary={roomSummaryWithDecisions(props.summary, props.awaitingDecisions, props.locale)} onResume={props.onResume} resumeBusy={props.busy === "resume"} />
      {props.persona?.setup.needsSetup ? (
        <article className="panel">
          <div className="warning-banner">
            Setup is incomplete: {props.persona.setup.reasonsText} <a href="#setup">Open Setup</a>
          </div>
        </article>
      ) : null}
      <AwaitingDecisionPanel
        callbacks={props.awaitingDecisions.callbacks}
        count={props.awaitingDecisions.count}
        maxGroups={1}
        onPromptPackGo={props.onPromptPackGo}
        busyKey={props.busy}
      />
      {props.spawnProposalQueue.count > 0 ? (
        <SpawnProposalQueuePanel
          count={props.spawnProposalQueue.count}
          proposals={props.spawnProposalQueue.proposals}
          onDecide={props.onDecideSpawnProposal}
          busyKey={props.busy}
        />
      ) : null}
    </section>
  );
}

function StatusPill(props: { status: string }) {
  const statusText = (() => {
    switch (props.status) {
      case "take_selected":
        return "Awaiting adoption";
      case "suno_take_url_ready":
        return "Listening URL ready";
      case "archived":
        return "Adopted";
      case "discarded":
        return "Discarded";
      case "building":
        return "Building";
      case "draft":
        return "Draft";
      case "completed":
        return "Completed";
      case "failed_closed":
        return "Needs action";
      default:
        return props.status.replace(/_/g, " ");
    }
  })();
  const statusTone = (() => {
    switch (props.status) {
      case "take_selected":
      case "suno_take_url_ready":
        return "waiting";
      case "archived":
      case "completed":
        return "done";
      case "discarded":
        return "muted";
      case "failed_closed":
        return "blocked";
      default:
        return "neutral";
    }
  })();
  return <span className={`status-pill status-pill-${statusTone}`}>{statusText}</span>;
}

export function SongsView(props: {
  locale?: ProducerRoomLocale;
  songs: SongSummary[];
  selectedSongId: string | null;
  onSelectSong: (songId: string) => void;
  onBack: () => void;
}) {
  const locale = props.locale ?? "en";
  const selected = props.selectedSongId;
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(props.songs.length / songLedgerPageSize));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * songLedgerPageSize;
  const visibleSongs = props.songs.slice(start, start + songLedgerPageSize);
  useEffect(() => {
    if (safePage !== page) {
      setPage(safePage);
    }
  }, [page, safePage]);
  return (
    <section className="single-column songs-view">
      <article className="panel">
        <div className="section-title">Songs</div>
        <div className="muted">{t(locale, "songsIntro")}</div>
        {props.songs.length === 0 ? (
          <div className="item muted">{t(locale, "songsEmpty")}</div>
        ) : (
          <>
            <div className="song-ledger-toolbar">
              <span className="muted">{start + 1}-{Math.min(start + songLedgerPageSize, props.songs.length)} / {props.songs.length} songs</span>
              <div className="inline-actions">
                <button type="button" disabled={safePage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Previous</button>
                <button type="button" disabled={safePage >= totalPages - 1} onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}>Next</button>
              </div>
            </div>
            <div className="song-ledger-list">
              {visibleSongs.map((song) => (
                <React.Fragment key={song.songId}>
                  <button
                    type="button"
                    className={`song-ledger-row${selected === song.songId ? " is-selected" : ""}`}
                    onClick={() => props.onSelectSong(song.songId)}
                  >
                    <span>
                      <strong>{song.title || song.songId}</strong>
                      <span className="muted">{song.runCount} runs</span>
                    </span>
                    <span>
                      <StatusPill status={song.status} />
                    </span>
                  </button>
                  {selected === song.songId ? (
                    <div className="song-ledger-detail">
                      <SongDetailCard key={selected} songId={selected} onBack={props.onBack} showBreadcrumb={false} />
                    </div>
                  ) : null}
                </React.Fragment>
              ))}
            </div>
          </>
        )}
      </article>
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
  locale?: ProducerRoomLocale;
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
  const locale = props.locale ?? "en";
  const draft = props.draft;
  const globalArmHeld = Boolean(draft && !draft.distributionLiveGoArmed);
  const authorityLabel = (value: string) => {
    switch (value) {
      case "auto_publish":
        return "Auto publish";
      case "auto_publish_visuals":
        return "Auto publish visuals";
      case "auto_publish_clips":
        return "Auto publish clips";
      case "auto_publish_and_low_risk_replies":
        return "Auto publish + low-risk replies";
      case "draft_only":
        return "Draft only";
      case "manual_approval":
        return "Manual approval";
      default:
        return value.replace(/_/g, " ");
    }
  };

  return (
    <section className="single-column settings-view">
      <article className="panel settings-panel">
        <div className="section-title">Settings</div>
        <div className="muted">{t(locale, "settingsIntro")}</div>
        {!props.config || !draft ? (
          <div className="item muted">{t(locale, "settingsLoading")}</div>
        ) : (
          <div className="settings-sections">
            <section className="settings-section">
              <div className="section-title">{t(locale, "settingsLanguage")}</div>
              <div className="muted">{t(locale, "settingsLanguageHelp")}</div>
              <label>
                <div className="eyebrow">Language</div>
                <select value={draft.uiLocale} onChange={(event) => props.onUpdateDraft({ uiLocale: event.target.value as ConfigDraft["uiLocale"] })}>
                  <option value="auto">Auto</option>
                  <option value="ja">日本語</option>
                  <option value="en">English</option>
                </select>
              </label>
            </section>
            <section className="settings-section">
              <div className="section-title">{t(locale, "settingsAutopilot")}</div>
              <label className="toggle"><input type="checkbox" checked={draft.autopilotEnabled} onChange={(event) => props.onUpdateDraft({ autopilotEnabled: event.target.checked })} />{t(locale, "settingsRunAutonomous")}</label>
              <label className="toggle"><input type="checkbox" checked={draft.dryRun} onChange={(event) => props.onUpdateDraft({ dryRun: event.target.checked })} />{t(locale, "settingsBlockExternal")}</label>
              <label className="toggle"><input type="checkbox" checked={draft.distributionLiveGoArmed} onChange={(event) => props.onUpdateDraft({ distributionLiveGoArmed: event.target.checked })} />{t(locale, "settingsAllowPublic")}</label>
              {globalArmHeld ? <div className="warning-banner">{t(locale, "settingsPublicHeld")}</div> : null}
              <div className="field-grid">
                <NumberField label={t(locale, "settingsSongsPerWeek")} value={draft.songsPerWeek} min={0} max={21} onChange={(value) => props.onUpdateDraft({ songsPerWeek: value })} />
                <NumberField label={t(locale, "settingsCycleInterval")} value={draft.cycleIntervalMinutes} min={15} max={1440} onChange={(value) => props.onUpdateDraft({ cycleIntervalMinutes: value })} />
              </div>
            </section>
            <section className="settings-section">
              <div className="section-title">{t(locale, "settingsSunoBudget")}</div>
              <div className="field-grid">
                <NumberField label={t(locale, "settingsDailyLimit")} value={draft.dailyCreditLimit} min={1} max={1000} onChange={(value) => props.onUpdateDraft({ dailyCreditLimit: value })} />
                <NumberField label={t(locale, "settingsMonthlyLimit")} value={draft.monthlyCreditLimit} min={0} max={50000} onChange={(value) => props.onUpdateDraft({ monthlyCreditLimit: value })} note={t(locale, "settingsMonthlyNote")} />
                <div className="settings-readonly">
                  <div className="eyebrow">Creation driver</div>
                  <strong>Browser worker</strong>
                  <div className="muted">{t(locale, "settingsCreationDriverHelp")}</div>
                </div>
                <div className="settings-readonly">
                  <div className="eyebrow">Create button</div>
                  <strong>Live submit</strong>
                  <div className="warning-banner">{t(locale, "settingsCreateButtonWarning")}</div>
                </div>
              </div>
            </section>
            <section className="settings-section">
              <div className="section-title">{t(locale, "settingsPlatforms")}</div>
              <div className="field-grid">
                <label className={`platform-config${globalArmHeld ? " is-held" : ""}`}>
                  <div className="toggle"><input type="checkbox" checked={draft.xEnabled} onChange={(event) => props.onUpdateDraft({ xEnabled: event.target.checked })} />{t(locale, "settingsUseX")}</div>
                  <div className="toggle"><input type="checkbox" checked={draft.xLiveGoArmed} onChange={(event) => props.onUpdateDraft({ xLiveGoArmed: event.target.checked })} />{t(locale, "settingsAllowX")}</div>
                  <div className="eyebrow">X authority</div>
                  <select value={draft.xAuthority} onChange={(event) => props.onUpdateDraft({ xAuthority: event.target.value as ConfigDraft["xAuthority"] })}>
                    {xAuthorityModes.map((mode) => <option key={mode} value={mode}>{authorityLabel(mode)}</option>)}
                  </select>
                </label>
                <div className="platform-config is-frozen" title="Frozen">
                  <div className="eyebrow">Instagram</div>
                  <strong>Frozen</strong>
                  <span className="badge badge-frozen">Not available</span>
                  <div className="muted">{t(locale, "settingsInstagramFrozen")}</div>
                </div>
                <div className="platform-config is-frozen" title="Account not ready / frozen">
                  <div className="eyebrow">TikTok</div>
                  <strong>Frozen</strong>
                  <span className="badge badge-frozen">Not available</span>
                  <div className="muted">{t(locale, "settingsTikTokFrozen")}</div>
                </div>
              </div>
            </section>
            {props.validationError ? <div className="field-error">{props.validationError}</div> : null}
            <div className="inline-actions">
              <button className="primary" type="button" disabled={props.busy || Boolean(props.validationError) || !props.dirty} onClick={props.onSave}>{t(locale, "settingsSave")}</button>
              <button type="button" disabled={props.busy || !props.dirty} onClick={props.onReset}>{t(locale, "settingsReset")}</button>
              <button type="button" disabled={props.busy} onClick={props.onRefresh}>{t(locale, "refresh")}</button>
            </div>
          </div>
        )}
      </article>
    </section>
  );
}

export function DiagnosticsView(props: { locale?: ProducerRoomLocale }) {
  const locale = props.locale ?? "en";
  return (
    <section className="single-column">
      <article className="panel">
        <div className="section-title">Diagnostics</div>
        <p>{t(locale, "diagnosticsIntro")}</p>
        <div className="item muted">{t(locale, "diagnosticsNote")}</div>
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
  const [personaAiSuggestions, setPersonaAiSuggestions] = useState<Partial<Record<PersonaField, PersonaAiSuggestion>>>({});
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
        setPersonaAiSuggestions({});
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
      showErrorToast("runtime", "resume_requested", "Resume requested.");
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
      showErrorToast("runtime", `spawn_${decision}_applied`, decision === "inject" ? "Started building the song." : "Dismissed the draft.");
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
      showErrorToast("runtime", "prompt_pack_go_applied", "Moved the song to Suno generation.");
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
      showErrorToast("config-patch", "config_updated", "Settings saved.");
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
    setPersonaAiSuggestions({});
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
      showErrorToast("config-patch", `persona_${layer}_updated`, "Setup draft saved.");
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
      showErrorToast("config-patch", `persona_${layer}_update_failed`, message);
    } finally {
      setBusy(null);
    }
  };

  const applyPersonaDraftProposal = (field: PersonaField, value: string) => {
    if (field === "producerFacts") {
      updateSnapshotPersonaDraft("producer", value);
      return;
    }
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

  const applyPersonaDraftProposalWithoutOverwrite = (field: PersonaField, value: string) => {
    if (!personaDraft) {
      return false;
    }
    if (field === "producerFacts") {
      if (personaDraft.snapshots.producer.trim()) return false;
      updateSnapshotPersonaDraft("producer", value);
      return true;
    }
    if (field === "soul-tone") {
      if (personaDraft.soul.conversationTone.trim()) return false;
      updateSoulPersonaDraft("conversationTone", value);
      return true;
    }
    if (field === "soul-refusal") {
      if (personaDraft.soul.refusalStyle.trim()) return false;
      updateSoulPersonaDraft("refusalStyle", value);
      return true;
    }
    const artistField = field as keyof ArtistPersonaDraft;
    if (personaDraft.artist[artistField]?.trim()) return false;
    updateArtistPersonaDraft(artistField, value);
    return true;
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
        showErrorToast("runtime", `persona_ai_${field}_skipped`, draft?.reasoning ?? "AI suggestion returned nothing usable.");
        return;
      }
      applyPersonaDraftProposal(field, draft.draft);
      const warning = response.warnings?.[0];
      showErrorToast("runtime", `persona_ai_${field}_proposed`, warning ? `AI suggestion applied: ${warning}` : "AI suggestion applied.");
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
      showErrorToast("runtime", `persona_ai_${field}_failed`, message);
    } finally {
      setBusy(null);
    }
  };

  const proposePersonaSuggestions = async (mode: "review_all" | "dedupe") => {
    setBusy(`persona-ai:${mode}`);
    try {
      const response = await apiPost<PersonaProposeResponse>("/persona/propose", {
        mode,
        fields: editablePersonaDraftFields()
      });
      if (response.error) {
        throw new Error(response.error);
      }
      const nextSuggestions: Partial<Record<PersonaField, PersonaAiSuggestion>> = {};
      for (const draft of response.drafts ?? []) {
        if (draft.status === "proposed") {
          nextSuggestions[draft.field] = { draft: draft.draft, reasoning: draft.reasoning, mode };
        }
      }
      setPersonaAiSuggestions(nextSuggestions);
      const count = Object.keys(nextSuggestions).length;
      const warning = response.warnings?.[0];
      showErrorToast(
        "runtime",
        `persona_ai_${mode}_ready`,
        warning ? `AI案 ${count} 件: ${warning}` : `AI案 ${count} 件を表示しました。保存はまだしていません。`
      );
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
      showErrorToast("runtime", `persona_ai_${mode}_failed`, message);
    } finally {
      setBusy(null);
    }
  };

  const applyPersonaAiSuggestion = (field: PersonaField) => {
    const suggestion = personaAiSuggestions[field];
    if (!suggestion) {
      return;
    }
    applyPersonaDraftProposal(field, suggestion.draft);
    setPersonaAiSuggestions((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const missingPersonaFields = (): PersonaField[] => {
    if (!personaDraft) {
      return [];
    }
    return emptyPersonaDraftFields(personaDraft);
  };

  const proposeMissingPersonaFields = async () => {
    const fields = missingPersonaFields();
    if (fields.length === 0) {
      showErrorToast("runtime", "persona_ai_missing_none", "未記入の欄はありません。");
      return;
    }
    setBusy("persona-ai:missing");
    try {
      const response = await apiPost<PersonaProposeResponse>("/persona/propose", { fields });
      if (response.error) {
        throw new Error(response.error);
      }
      let applied = 0;
      for (const draft of response.drafts ?? []) {
        if (draft.status === "proposed" && applyPersonaDraftProposalWithoutOverwrite(draft.field, draft.draft)) {
          applied += 1;
        }
      }
      const warning = response.warnings?.[0];
      showErrorToast(
        "runtime",
        "persona_ai_missing_proposed",
        warning ? `AIで${applied}件補完しました: ${warning}` : `AIで${applied}件補完しました。`
      );
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
      showErrorToast("runtime", "persona_ai_missing_failed", message);
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
      showErrorToast("runtime", "persona_setup_complete", "Setup completion recorded.");
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
      showErrorToast("runtime", "persona_setup_complete_failed", message);
    } finally {
      setBusy(null);
    }
  };

  const summary = status?.autopilot.nextActionSummary ?? fallbackSummary(status);
  const configValidationError = configDraft ? validateConfigDraft(configDraft) : null;
  const locale = resolveProducerRoomLocale(configDraft?.uiLocale ?? config?.ui?.locale);
  return (
    <main className="console-shell producer-room-shell">
      <header className="hero producer-room-hero">
        <div>
          <div className="eyebrow">Artist Operations</div>
          <h1>Producer Room</h1>
          <div className="hero-copy">If you are unsure, look here. When action is needed, this room shows one move.</div>
        </div>
        <div className="producer-room-refresh-pill">
          {lastRefreshAt ? `Updated ${new Date(lastRefreshAt).toLocaleTimeString()}` : "Loading"}
        </div>
      </header>
      <RouteNav activeView={activeView} />
      {activeView === "room" ? (
        <RoomViewPanel
          status={status}
          locale={locale}
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
        <SongsView locale={locale} songs={songs} selectedSongId={selectedSongId} onSelectSong={selectSong} onBack={clearSong} />
      ) : null}
      {activeView === "settings" ? (
        <SettingsView
          config={config}
          locale={locale}
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
          locale={locale}
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
          onProposeMissing={proposeMissingPersonaFields}
          onProposeReview={() => proposePersonaSuggestions("review_all")}
          onProposeDedupe={() => proposePersonaSuggestions("dedupe")}
          aiSuggestions={personaAiSuggestions}
          onApplySuggestion={applyPersonaAiSuggestion}
          onComplete={completePersonaSetup}
        />
      ) : null}
      {activeView === "diagnostics" ? <DiagnosticsView locale={locale} /> : null}
      <footer className="producer-room-closing-band">
        <strong>Quiet by default.</strong>
        <span>Only creative milestones, hard stops, and the next required move surface here.</span>
      </footer>
      <ErrorToastStack toasts={errorToasts} onDismiss={(id) => setErrorToasts((current) => dismissErrorToast(current, id))} />
    </main>
  );
}
