import React from "react";

export type SpawnProposalQueueAction = {
  action: string;
  label: string;
  effect: string;
};

export type SpawnProposalQueueItem = {
  proposalId: string;
  createdAt: string;
  status: string;
  title: string;
  voiceTop: string;
  coreTheme: string;
  motifRank?: number;
  cascadeTrace?: {
    observationSources?: Array<{ label?: string; quote?: string; url?: string }>;
    artistVoice?: string;
    title?: string;
    lyricsTheme?: string;
    styleLayer?: string;
  };
  actions: SpawnProposalQueueAction[];
};

export interface SpawnProposalQueuePanelProps {
  count: number;
  proposals: SpawnProposalQueueItem[];
  // Plan v10.65 Layer 2: receive-independent spawn GO. When provided, inject/skip
  // buttons act via the Console API instead of being display-only.
  onDecide?: (proposalId: string, decision: "inject" | "skip") => void;
  busyKey?: string | null;
}

function spawnDecisionFor(action: string): "inject" | "skip" | undefined {
  if (action === "song_spawn_inject") return "inject";
  if (action === "song_spawn_skip") return "skip";
  return undefined;
}

function firstLine(value: string | undefined): string {
  return value?.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "artist voice 未記録";
}

function sourceLine(proposal: SpawnProposalQueueItem): string {
  const source = proposal.cascadeTrace?.observationSources?.[0];
  if (!source) return "観察 source: 未記録";
  const quote = source.quote ? `「${source.quote}」` : "引用なし";
  return source.url ? `観察 source: ${source.label ?? "source"} ${quote} ${source.url}` : `観察 source: ${source.label ?? "source"} ${quote}`;
}

export function SpawnProposalQueuePanel({ count, proposals, onDecide, busyKey }: SpawnProposalQueuePanelProps) {
  return (
    <article className={`panel spawn-proposal-queue-panel${count > 0 ? " has-proposals" : ""}`}>
      <div className="section-title">草稿箱</div>
      {count === 0 ? (
        <div className="muted">保存中の曲草稿はありません。</div>
      ) : (
        <div className="list spawn-proposal-queue-list">
          {proposals.map((proposal) => (
            <div className="item spawn-proposal-card" key={proposal.proposalId}>
              <strong>{proposal.title}</strong>
              <div className="muted">{proposal.proposalId} · {proposal.status} · {new Date(proposal.createdAt).toLocaleString()}</div>
              <p>{firstLine(proposal.voiceTop || proposal.cascadeTrace?.artistVoice)}</p>
              <div className="muted">theme: {proposal.coreTheme}</div>
              <div className="muted">{sourceLine(proposal)}</div>
              <div className="muted">style: {proposal.cascadeTrace?.styleLayer ?? "未記録"}</div>
              <div className="inline-actions">
                {proposal.actions.map((action) => {
                  const decision = spawnDecisionFor(action.action);
                  const actionable = Boolean(onDecide && decision);
                  const isBusy = decision ? busyKey === `spawn-${decision}:${proposal.proposalId}` : false;
                  return (
                    <button
                      type="button"
                      key={action.action}
                      disabled={!actionable || busyKey != null}
                      title={action.effect}
                      onClick={actionable && decision ? () => onDecide?.(proposal.proposalId, decision) : undefined}
                    >
                      {isBusy ? "送信中…" : action.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {count > proposals.length ? <div className="muted">ほか {count - proposals.length} 件あります。</div> : null}
      <div className="muted">Telegram の草稿カード、または上のボタンから実行できます。作るボタンは完成報告まで進め、外部公開はしません。</div>
    </article>
  );
}
