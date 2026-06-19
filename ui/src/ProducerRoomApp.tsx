import React, { useEffect, useState } from "react";
import { ErrorToastStack } from "./ErrorToast";
import { AwaitingDecisionPanel, type AwaitingDecision } from "./components/AwaitingDecisionPanel";
import { SongLifecycleTimelineCard } from "./components/SongLifecycleTimelineCard";
import { SpawnProposalQueuePanel, type SpawnProposalQueueItem } from "./components/SpawnProposalQueuePanel";
import { useHashRoute } from "./hooks/useHashRoute";
import { dismissErrorToast, expireErrorToasts, pushErrorToast, type ErrorToast, type ErrorToastSource } from "../../src/services/errorToastQueue";
import type { DraftBoxNextActionSummary } from "../../src/types";

const refreshIntervalMs = 5000;
const apiBase = "/plugins/artist-runtime/api";
const fetchTimeoutMs = 10_000;

type RoomView = "room" | "songs" | "settings" | "diagnostics";

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

type CallbackActionsResponse = {
  count: number;
  callbacks: AwaitingDecision[];
};

type SpawnProposalsResponse = {
  count: number;
  proposals: SpawnProposalQueueItem[];
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
  if (hash === "#settings") return "settings";
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
  return kind === "hard_stop" || kind === "paused" || kind === "reauth_required" || kind === "suno_trouble";
}

function canLine(summary: DraftBoxNextActionSummary): string {
  switch (summary.kind) {
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
    <>
      <nav className="view-tabs producer-room-tabs" aria-label="Producer Room views">
        <a className={linkClass("room")} href="#room">Room</a>
        <a className={linkClass("songs")} href="#songs">Songs</a>
        <a className={linkClass("settings")} href="#settings">Settings</a>
      </nav>
      <footer className="producer-room-footer">
        <a href="#diagnostics">診断</a>
      </footer>
    </>
  );
}

function RoomViewPanel(props: {
  status: StatusResponse | null;
  summary: DraftBoxNextActionSummary;
  awaitingDecisions: CallbackActionsResponse;
  spawnProposalQueue: SpawnProposalsResponse;
  busy: string | null;
  selectedSongId: string | null;
  onResume: () => void;
  onPromptPackGo: (songId: string) => void;
  onDecideSpawnProposal: (proposalId: string, decision: "inject" | "skip") => void;
}) {
  return (
    <section className="single-column producer-room-grid">
      <RoomHeader summary={props.summary} onResume={props.onResume} resumeBusy={props.busy === "resume"} />
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
        onPromptPackGo={props.onPromptPackGo}
        busyKey={props.busy}
      />
    </section>
  );
}

function StubPanel(props: { title: string; detail: string }) {
  return (
    <section className="single-column">
      <article className="panel">
        <div className="section-title">{props.title}</div>
        <p>{props.detail}</p>
        <div className="muted">Phase C で実装します。</div>
      </article>
    </section>
  );
}

function DiagnosticsStub(props: { status: StatusResponse | null }) {
  return (
    <section className="single-column">
      <article className="panel">
        <div className="section-title">診断</div>
        <p>旧 Console は Phase D でここへ移します。Room には内部操作の主導ボタンを出しません。</p>
        <pre className="debug-json">{JSON.stringify({
          stage: props.status?.autopilot.stage,
          nextAction: props.status?.autopilot.nextAction,
          currentSongId: props.status?.autopilot.currentSongId
        }, null, 2)}</pre>
      </article>
    </section>
  );
}

export function ProducerRoomApp() {
  const activeView = useRoomView();
  const { selectedSongId } = useHashRoute();
  const [status, setStatus] = useState<StatusResponse | null>(null);
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
      const [nextStatus, nextAwaitingDecisions, nextSpawnProposalQueue] = await Promise.all([
        apiGet<StatusResponse>("/status"),
        apiGet<CallbackActionsResponse>("/callback-actions?status=pending&category=producer_decision"),
        apiGet<SpawnProposalsResponse>("/spawn-proposals?status=draft&limit=20")
      ]);
      setStatus(nextStatus);
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

  const summary = status?.autopilot.nextActionSummary ?? fallbackSummary(status);

  return (
    <main className="console-shell producer-room-shell">
      <header className="hero producer-room-hero">
        <div>
          <div className="eyebrow">used::honda Artist Runtime</div>
          <h1>Producer Room</h1>
          <div className="hero-copy">迷ったら、ここだけ見る。必要な操作は blocked 時に 1 つだけ出す。</div>
        </div>
        <div className="muted">
          {lastRefreshAt ? `last refresh ${new Date(lastRefreshAt).toLocaleTimeString()}` : "loading"}
        </div>
      </header>
      <RouteNav activeView={activeView} />
      {activeView === "room" ? (
        <RoomViewPanel
          status={status}
          summary={summary}
          awaitingDecisions={awaitingDecisions}
          spawnProposalQueue={spawnProposalQueue}
          busy={busy}
          selectedSongId={selectedSongId}
          onResume={resumeAutopilot}
          onPromptPackGo={goPromptPack}
          onDecideSpawnProposal={decideSpawnProposal}
        />
      ) : null}
      {activeView === "songs" ? <StubPanel title="Songs" detail="作品一覧と採用/破棄の整理面です。" /> : null}
      {activeView === "settings" ? <StubPanel title="Settings" detail="platform / authority / budget / cadence / hard-stop の steer 面です。" /> : null}
      {activeView === "diagnostics" ? <DiagnosticsStub status={status} /> : null}
      <ErrorToastStack toasts={errorToasts} onDismiss={(id) => setErrorToasts((current) => dismissErrorToast(current, id))} />
    </main>
  );
}
