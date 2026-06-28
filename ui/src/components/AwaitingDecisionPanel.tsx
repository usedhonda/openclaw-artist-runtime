import React from "react";

export type AwaitingDecision = {
  callbackId: string;
  action: string;
  label: string;
  effect: string;
  songId?: string;
  proposalId?: string;
  songTitle?: string;
  stage?: string;
  createdAt: number;
  expiresAt: number;
  reminderSentAt?: number;
};

export type AwaitingDecisionGroup = AwaitingDecision & {
  actions: string[];
  hiddenDuplicateCount: number;
  promptPackGoSongId?: string;
};

export interface AwaitingDecisionPanelProps {
  callbacks: AwaitingDecision[];
  count: number;
  now?: number;
  maxGroups?: number;
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
  if (callback.songTitle) return callback.songTitle;
  if (callback.proposalId || callback.action.startsWith("song_spawn_")) return "この素案";
  return "この曲";
}

function groupKey(callback: AwaitingDecision): string {
  return callback.songId ?? callback.proposalId ?? callback.callbackId;
}

function actionSummary(callbacks: AwaitingDecision[]): string[] {
  const labels = relevantCallbacks(callbacks).map((callback) => callback.label).filter(Boolean);
  return [...new Set(labels)];
}

function stageLabel(stage?: string): string {
  switch (stage) {
    case "asset_generation":
    case "take_selected":
    case "take_selection":
      return "完成後の採用待ち";
    case "prompt_pack_ready":
      return "Suno に進める判断待ち";
    case "spawn_proposal_ready":
      return "素案の判断待ち";
    default:
      return "判断待ち";
  }
}

function relevantCallbacks(callbacks: AwaitingDecision[]): AwaitingDecision[] {
  const archiveActions = callbacks.filter((callback) => callback.action === "song_archive" || callback.action === "song_discard");
  if (archiveActions.length > 0) return archiveActions;
  const promptPackActions = callbacks.filter((callback) => callback.action.startsWith("prompt_pack_"));
  if (promptPackActions.length > 0) return promptPackActions;
  const spawnActions = callbacks.filter((callback) => callback.action.startsWith("song_spawn_"));
  if (spawnActions.length > 0) return spawnActions;
  return callbacks;
}

export function groupAwaitingDecisions(callbacks: AwaitingDecision[]): AwaitingDecisionGroup[] {
  const groups = new Map<string, AwaitingDecision[]>();
  for (const callback of callbacks) {
    const key = groupKey(callback);
    groups.set(key, [...(groups.get(key) ?? []), callback]);
  }

  return [...groups.values()]
    .map((group) => {
      const sorted = [...group].sort((a, b) => b.createdAt - a.createdAt);
      const primary = sorted[0];
      const relevant = relevantCallbacks(sorted);
      const promptPackGo = relevant.find((callback) => callback.action === "prompt_pack_go" && callback.songId);
      return {
        ...primary,
        actions: actionSummary(relevant),
        hiddenDuplicateCount: Math.max(0, sorted.length - 1),
        promptPackGoSongId: promptPackGo?.songId
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function AwaitingDecisionPanel({ callbacks, count, now = Date.now(), maxGroups, onPromptPackGo, busyKey }: AwaitingDecisionPanelProps) {
  const groupedCallbacks = groupAwaitingDecisions(callbacks);
  const visibleGroups = typeof maxGroups === "number" ? groupedCallbacks.slice(0, Math.max(0, maxGroups)) : groupedCallbacks;
  const hiddenGroupCount = Math.max(0, groupedCallbacks.length - visibleGroups.length);
  return (
    <article className={`panel awaiting-decision-panel${count > 0 ? " has-waiting" : ""}`}>
      <div className="section-title">判断待ち</div>
      {count === 0 ? (
        <div className="muted">採用/破棄/進行待ちはありません。</div>
      ) : (
        <div className="list awaiting-decision-list">
          {visibleGroups.map((callback) => (
            <div className="item awaiting-decision-row" key={groupKey(callback)}>
              <div>
                <strong>{targetLabel(callback)}</strong>
                <div className="muted">{stageLabel(callback.stage)} · {elapsed(callback.createdAt, now)}待ち</div>
                <div className="muted">選択肢: {callback.actions.join(" / ")}</div>
                <div className="muted">次: Telegram の最新通知で選ぶ</div>
                {callback.hiddenDuplicateCount > 0 ? <div className="muted">古い重複通知 {callback.hiddenDuplicateCount} 件をまとめています。</div> : null}
                {callback.reminderSentAt ? <div className="muted">再通知済み: {elapsed(callback.reminderSentAt, now)}前</div> : null}
                {callback.promptPackGoSongId && onPromptPackGo ? (
                  <div className="inline-actions">
                    <button
                      type="button"
                      disabled={busyKey != null}
                      title="Suno 生成へ進めます (外部公開はしません)"
                      onClick={() => onPromptPackGo(callback.promptPackGoSongId as string)}
                    >
                      {busyKey === `prompt-pack-go:${callback.promptPackGoSongId}` ? "送信中…" : "Suno 生成へ進める"}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
      {hiddenGroupCount > 0 ? <div className="muted">ほか {hiddenGroupCount} 曲の判断待ちは畳んでいます。</div> : null}
      {callbacks.length > groupedCallbacks.length ? <div className="muted">同じ曲の古い通知はここでは増やしません。</div> : null}
      <div className="muted">Telegram の最新通知、または /status から現在地を確認できます。</div>
    </article>
  );
}
