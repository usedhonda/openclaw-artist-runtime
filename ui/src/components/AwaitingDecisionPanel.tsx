import React from "react";

export type AwaitingDecision = {
  callbackId: string;
  action: string;
  label: string;
  effect: string;
  songId?: string;
  songTitle?: string;
  stage?: string;
  createdAt: number;
  expiresAt: number;
  reminderSentAt?: number;
};

export interface AwaitingDecisionPanelProps {
  callbacks: AwaitingDecision[];
  count: number;
  now?: number;
  // Plan v10.65 Layer 2: receive-independent Suno pre-GO. When provided, a
  // prompt_pack_go callback can be advanced from the Console.
  onPromptPackGo?: (songId: string) => void;
  busyKey?: string | null;
}

function elapsed(timestamp: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  if (minutes < 60) return `${minutes}分`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間`;
  return `${Math.floor(hours / 24)}日`;
}

function targetLabel(callback: AwaitingDecision): string {
  if (callback.songId && callback.songTitle) return `${callback.songId} / ${callback.songTitle}`;
  return callback.songId ?? callback.action;
}

export function AwaitingDecisionPanel({ callbacks, count, now = Date.now(), onPromptPackGo, busyKey }: AwaitingDecisionPanelProps) {
  return (
    <article className={`panel awaiting-decision-panel${count > 0 ? " has-waiting" : ""}`}>
      <div className="section-title">Awaiting Producer Decision</div>
      {count === 0 ? (
        <div className="muted">採用/破棄/進行待ちの producer decision はありません。</div>
      ) : (
        <div className="list awaiting-decision-list">
          {callbacks.map((callback) => (
            <div className="item awaiting-decision-row" key={callback.callbackId}>
              <div>
                <strong>{targetLabel(callback)}</strong>
                <div className="muted">{callback.stage ?? "stage 不明"} · {elapsed(callback.createdAt, now)}待ち</div>
                <div className="muted">{callback.label}: {callback.effect}</div>
                {callback.reminderSentAt ? <div className="muted">reminder 済み: {elapsed(callback.reminderSentAt, now)}前</div> : null}
                {callback.action === "prompt_pack_go" && callback.songId && onPromptPackGo ? (
                  <div className="inline-actions">
                    <button
                      type="button"
                      disabled={busyKey != null}
                      title="Suno 生成へ進めます (外部公開はしません)"
                      onClick={() => onPromptPackGo(callback.songId as string)}
                    >
                      {busyKey === `prompt-pack-go:${callback.songId}` ? "送信中…" : "Suno 生成へ進める"}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
      {count > callbacks.length ? <div className="muted">ほか {count - callbacks.length} 件あります。</div> : null}
      <div className="muted">Telegram の最新通知、または /status から現在地を確認できます。</div>
    </article>
  );
}
