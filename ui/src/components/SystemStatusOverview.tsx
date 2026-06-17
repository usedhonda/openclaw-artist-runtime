import React from "react";

type PendingCallback = {
  callbackId: string;
  action: string;
  category?: "producer_decision" | "working_confirmation";
  label: string;
  effect: string;
  songId?: string;
  proposalId?: string;
  platform?: string;
  createdAt: number;
  expiresAt: number;
  reminderSentAt?: number;
};

type FailedNotification = {
  notifyId: string;
  eventType: string;
  songId?: string;
  errorMessage: string;
  attempts: number;
  failedAt: string;
};

type StatusShape = {
  autopilot: {
    stage: string;
    nextAction: string;
    currentSongId?: string;
    blockedReason?: string;
    lastError?: string;
  };
  ticker: {
    lastOutcome?: string;
    lastTickAt?: string;
    intervalMs: number;
  };
  sunoWorker: {
    state: string;
    connected?: boolean;
    pendingAction?: string;
    hardStopReason?: string;
    currentRunId?: string;
    lastImportedRunId?: string;
  };
  pendingCallbacks?: {
    count: number;
    recent: PendingCallback[];
  };
  failedNotifications?: {
    count: number;
    recent: FailedNotification[];
  };
  awaitingSunoTakeUrlReady?: {
    count: number;
    recent: Array<{
      songId: string;
      title: string;
      selectedTakeId?: string;
      urls: string[];
      updatedAt?: string;
    }>;
  };
  recentSong?: {
    songId: string;
    title: string;
    status: string;
  };
};

export interface SystemStatusOverviewProps {
  status: StatusShape | null;
  now?: number;
}

function relativeMinutes(value: string | undefined, now: number): string {
  if (!value) return "tick なし";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  const minutes = Math.round((parsed - now) / 60000);
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(minutes, "minute");
}

function callbackTarget(callback: PendingCallback): string {
  if (callback.songId) return callback.songId;
  if (callback.proposalId) return callback.proposalId;
  if (callback.platform) return callback.platform;
  return callback.action;
}

function expiresIn(callback: PendingCallback, now: number): string {
  const minutes = Math.max(0, Math.ceil((callback.expiresAt - now) / 60000));
  if (minutes >= 120) return `${Math.ceil(minutes / 60)}h`;
  return `${minutes}m`;
}

export function SystemStatusOverview({ status, now = Date.now() }: SystemStatusOverviewProps) {
  const pendingCallbacks = status?.pendingCallbacks?.recent ?? [];
  const failedNotifications = status?.failedNotifications?.recent ?? [];
  const awaitingSunoTakeUrlReady = status?.awaitingSunoTakeUrlReady?.recent ?? [];
  const [replayingNotifyId, setReplayingNotifyId] = React.useState<string | null>(null);
  const [replayMessage, setReplayMessage] = React.useState<string | null>(null);
  const currentSong = status?.recentSong ?? (status?.autopilot.currentSongId
    ? { songId: status.autopilot.currentSongId, title: status.autopilot.currentSongId, status: status.autopilot.stage }
    : undefined);
  const blocked = status?.autopilot.blockedReason ?? status?.autopilot.lastError;
  const sunoDetail = status?.sunoWorker.hardStopReason
    ?? status?.sunoWorker.pendingAction
    ?? (status?.sunoWorker.connected ? "接続済み" : "待機中");
  const replayNotification = async (notifyId: string) => {
    setReplayingNotifyId(notifyId);
    setReplayMessage(null);
    try {
      const response = await fetch(`/plugins/artist-runtime/api/notify/replay/${encodeURIComponent(notifyId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      const body = await response.json() as { replayed?: boolean; reason?: string; error?: string };
      setReplayMessage(body.replayed ? "再送しました。" : `再送できません: ${body.reason ?? body.error ?? response.status}`);
    } catch (error) {
      setReplayMessage(`再送できません: ${(error as Error)?.message ?? error}`);
    } finally {
      setReplayingNotifyId(null);
    }
  };

  return (
    <article className="panel system-status-overview">
      <div className="section-title">System Status Overview</div>
      <div className="system-status-grid">
        <div className={`item system-status-item ${blocked ? "needs-attention" : "is-ok"}`}>
          <div className="eyebrow">今の状態</div>
          <strong>{status?.autopilot.stage ?? "loading"}</strong>
          <div className="muted">{blocked ?? status?.autopilot.nextAction ?? "状態を取得中"}</div>
        </div>
        <div className="item system-status-item">
          <div className="eyebrow">対象 song</div>
          <strong>{currentSong?.songId ?? "-"}</strong>
          <div className="muted">{currentSong ? `${currentSong.title} · ${currentSong.status}` : "曲は未選択"}</div>
        </div>
        <div className={`item system-status-item ${awaitingSunoTakeUrlReady.length > 0 ? "needs-attention" : "is-ok"}`}>
          <div className="eyebrow">Suno URL 採用待ち</div>
          <strong>{status?.awaitingSunoTakeUrlReady?.count ?? 0}</strong>
          <div className="muted">
            {awaitingSunoTakeUrlReady[0]
              ? `${awaitingSunoTakeUrlReady[0].songId} · ${awaitingSunoTakeUrlReady[0].title}`
              : "採用待ち URL なし"}
          </div>
        </div>
        <div className={`item system-status-item ${status?.sunoWorker.connected ? "is-ok" : "needs-attention"}`}>
          <div className="eyebrow">Suno worker</div>
          <strong>{status?.sunoWorker.state ?? "-"}</strong>
          <div className="muted">{sunoDetail}</div>
          <div className="muted">run {status?.sunoWorker.currentRunId ?? "-"} · imported {status?.sunoWorker.lastImportedRunId ?? "-"}</div>
        </div>
        <div className="item system-status-item">
          <div className="eyebrow">Ticker</div>
          <strong>{status?.ticker.lastOutcome ?? "never"}</strong>
          <div className="muted">{status ? `${relativeMinutes(status.ticker.lastTickAt, now)} · ${status.ticker.intervalMs}ms` : "loading"}</div>
        </div>
      </div>
      <div className="system-button-effects">
        <div className="eyebrow">次に押せるボタン</div>
        {pendingCallbacks.length === 0 ? (
          <div className="item muted">今すぐ処理待ちのボタンはありません。</div>
        ) : (
          <div className="list">
            {pendingCallbacks.map((callback) => (
              <div className="item system-button-effect" key={callback.callbackId}>
                <strong>{callback.label}</strong>
                <div className="muted">{callbackTarget(callback)} · {callback.effect}</div>
                <div className="muted">expires in {expiresIn(callback, now)}</div>
              </div>
            ))}
          </div>
        )}
        {status?.pendingCallbacks && status.pendingCallbacks.count > pendingCallbacks.length ? (
          <div className="muted">ほか {status.pendingCallbacks.count - pendingCallbacks.length} 件は callback ledger に残っています。</div>
        ) : null}
      </div>
      <div className="system-button-effects">
        <div className="eyebrow">Telegram 通知失敗</div>
        {failedNotifications.length === 0 ? (
          <div className="item muted">再送待ちの通知はありません。</div>
        ) : (
          <div className="list">
            {failedNotifications.map((notification) => (
              <div className="item system-button-effect" key={notification.notifyId}>
                <strong>{notification.eventType}</strong>
                <div className="muted">{notification.songId ?? "-"} · {notification.errorMessage}</div>
                <div className="muted">{notification.attempts} attempts · {relativeMinutes(notification.failedAt, now)}</div>
                <button
                  className="link-button"
                  disabled={replayingNotifyId === notification.notifyId}
                  onClick={() => {
                    void replayNotification(notification.notifyId);
                  }}
                  type="button"
                >
                  再送
                </button>
              </div>
            ))}
          </div>
        )}
        {status?.failedNotifications && status.failedNotifications.count > failedNotifications.length ? (
          <div className="muted">ほか {status.failedNotifications.count - failedNotifications.length} 件は failed-notify ledger に残っています。</div>
        ) : null}
        {replayMessage ? <div className="muted">{replayMessage}</div> : null}
      </div>
    </article>
  );
}
