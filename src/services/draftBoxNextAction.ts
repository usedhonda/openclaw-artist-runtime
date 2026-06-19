import { readAutopilotState } from "./autopilotRecovery.js";
import { readSongState } from "./artistState.js";
import { loadSpawnProposalQueue } from "./spawnProposalQueue.js";
import type { AutopilotRunState, DraftBoxNextActionSummary, SpawnProposal } from "../types.js";

const SUNO_TROUBLE_PATTERN = /(?:playwright_live_timeout|timeout|suno_generate_retry|suno_worker_not_connected|suno_worker_not_ready|disconnected|ECONNRESET|ENETUNREACH|EAI_AGAIN|fetch failed)/i;

function titleFromProposal(proposal: SpawnProposal | undefined): string | undefined {
  return proposal?.title?.trim() || proposal?.proposalId;
}

function safeStatePart(value: string | undefined): string {
  return (value ?? "none").replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 96);
}

function troubleReason(state: AutopilotRunState): string | undefined {
  const raw = [state.blockedReason, state.lastError, state.hardStopReason].filter(Boolean).join(" ");
  if (state.stage !== "suno_generation" && !SUNO_TROUBLE_PATTERN.test(raw)) return undefined;
  return SUNO_TROUBLE_PATTERN.test(raw) ? raw : undefined;
}

function reauthRequiredReason(state: AutopilotRunState): string | undefined {
  const values = [state.blockedReason, state.lastError, state.pausedReason].filter(Boolean) as string[];
  return values.find((value) => value.includes("ai_provider_not_configured"));
}

function troubleStatePart(reason: string | undefined): string {
  const value = reason ?? "";
  if (/playwright_live_timeout|timeout/i.test(value)) return "timeout";
  if (/suno_generate_retry/i.test(value)) return "generate_retry";
  if (/suno_worker_not_connected|suno_worker_not_ready|disconnected/i.test(value)) return "worker_not_ready";
  if (/ECONNRESET|ENETUNREACH|EAI_AGAIN|fetch failed/i.test(value)) return "network";
  return safeStatePart(value);
}

export async function composeDraftBoxNextAction(
  root: string,
  options: { state?: AutopilotRunState } = {}
): Promise<DraftBoxNextActionSummary> {
  const state = options.state ?? await readAutopilotState(root);
  const proposals = await loadSpawnProposalQueue(root).catch(() => []);
  const drafts = proposals.filter((proposal) => proposal.status === "draft");
  const buildings = proposals.filter((proposal) => proposal.status === "building");
  const building = buildings.find((proposal) => proposal.proposalId === state.currentSongId) ?? buildings[0];
  const song = state.currentSongId ? await readSongState(root, state.currentSongId).catch(() => undefined) : undefined;
  const title = song?.title ?? titleFromProposal(building);
  const reauthReason = reauthRequiredReason(state);
  const reason = troubleReason(state);

  if (state.hardStopReason) {
    return {
      kind: "hard_stop",
      currentLine: `今: hard stop で停止中${state.currentSongId ? ` (${state.currentSongId})` : ""}`,
      draftCount: drafts.length,
      buildingCount: buildings.length,
      nextAction: "次: /status で理由を確認。hard stop が消えるまで作成は進めない。",
      stateKey: `hard_stop:${safeStatePart(state.currentSongId)}:${safeStatePart(state.hardStopReason)}`,
      songId: state.currentSongId,
      title,
      reason: state.hardStopReason
    };
  }

  if (reauthReason) {
    return {
      kind: "reauth_required",
      currentLine: "今: 歌詞AIのトークンが失効し制作が止まっている",
      draftCount: drafts.length,
      buildingCount: buildings.length,
      nextAction: "次: 歌詞AIの再認証が必要。/resume では直りません",
      stateKey: `reauth_required:${safeStatePart(state.currentSongId)}:${safeStatePart(reauthReason)}`,
      songId: state.currentSongId,
      title,
      reason: reauthReason
    };
  }

  if (reason) {
    return {
      kind: "suno_trouble",
      currentLine: `今: ${title ?? state.currentSongId ?? "曲"} が Suno 生成で詰まっている`,
      draftCount: drafts.length,
      buildingCount: buildings.length,
      nextAction: "次: Suno 接続を整える。戻ったら自動で続きから確認する。",
      stateKey: `suno_trouble:${safeStatePart(state.currentSongId)}:${troubleStatePart(reason)}`,
      songId: state.currentSongId,
      title,
      reason
    };
  }

  if (state.paused) {
    return {
      kind: "paused",
      currentLine: `今: autopilot は停止中${state.currentSongId ? ` (${state.currentSongId})` : ""}`,
      draftCount: drafts.length,
      buildingCount: buildings.length,
      nextAction: "次: /resume で再開できる。GO 待ちのボタンは Telegram の最新通知を見る。",
      stateKey: `paused:${safeStatePart(state.currentSongId)}:${safeStatePart(state.pausedReason ?? state.suspendedAt ?? undefined)}`,
      songId: state.currentSongId,
      title,
      reason: state.pausedReason ?? state.suspendedAt ?? undefined
    };
  }

  if (building || state.currentSongId) {
    return {
      kind: "building",
      currentLine: `今: ${title ?? state.currentSongId ?? "曲"} を作っている`,
      draftCount: drafts.length,
      buildingCount: buildings.length,
      nextAction: "次: 完成通知を待つ。別の草稿は作成待ちにせず草稿箱に残す。",
      stateKey: `building:${safeStatePart(state.currentSongId ?? building?.proposalId)}:${safeStatePart(state.stage)}`,
      songId: state.currentSongId ?? building?.proposalId,
      title
    };
  }

  if (drafts.length > 0) {
    return {
      kind: "draft_idle",
      currentLine: "今: 手が空いている",
      draftCount: drafts.length,
      buildingCount: 0,
      nextAction: "次: 草稿箱から「作る」を押す。",
      stateKey: `draft_idle:count:${drafts.length}`,
      title: titleFromProposal(drafts[0])
    };
  }

  return {
    kind: "empty",
    currentLine: "今: 次の素案を探している",
    draftCount: 0,
    buildingCount: 0,
    nextAction: "次: 素案通知を待つ。急ぐなら /commission <作りたい内容> を送る。",
    stateKey: "empty"
  };
}

export function formatDraftBoxNextActionSection(summary: DraftBoxNextActionSummary): string {
  return [
    "現在地:",
    summary.currentLine,
    `草稿箱: draft ${summary.draftCount}件 / building ${summary.buildingCount}件`,
    summary.reason ? `理由: ${summary.reason}` : undefined,
    summary.nextAction
  ].filter((line): line is string => Boolean(line)).join("\n");
}
