import { listSongStates, readSongState } from "./artistState.js";
import { readAutopilotRunState } from "./autopilotService.js";
import { isProposalConfirmationAction, listPendingCallbackActionSummaries } from "./callbackActionRegistry.js";
import { composeDraftBoxNextAction, formatDraftBoxNextActionSection } from "./draftBoxNextAction.js";
import { readReceiveHealth } from "./receiveHealthService.js";
import type { AutopilotStatus } from "../types.js";

export interface ProducerStatusOptions {
  now?: number;
  dashboardBaseUrl?: string;
  limit?: number;
  autopilotStatus?: AutopilotStatus;
}

type PendingCallback = Awaited<ReturnType<typeof listPendingCallbackActionSummaries>>["recent"][number];
type PendingSummary = Awaited<ReturnType<typeof listPendingCallbackActionSummaries>>;

function elapsedLabel(timestamp: number, now: number): string {
  const diffMinutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (diffMinutes < 1) return "たった今";
  if (diffMinutes < 60) return `${diffMinutes}分前`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}時間前`;
  return `${Math.floor(diffHours / 24)}日前`;
}

function dashboardLine(baseUrl: string | undefined, songId: string | undefined): string | undefined {
  if (!baseUrl || !songId) return undefined;
  const base = baseUrl.replace(/\/+$/, "");
  return `Dashboard: ${base}/plugins/artist-runtime#song=${encodeURIComponent(songId)}`;
}

function sameDecisionNotice(left: PendingCallback, right: PendingCallback): boolean {
  const leftTarget = left.songId ?? left.proposalId ?? left.action;
  const rightTarget = right.songId ?? right.proposalId ?? right.action;
  return leftTarget === rightTarget && left.messageId === right.messageId;
}

async function latestWaitingLines(
  root: string,
  pending: PendingSummary,
  now: number
): Promise<{ lines: string[]; nextLine?: string }> {
  const latest = pending.recent[0];
  if (!latest) {
    return { lines: ["- 操作待ち: なし"] };
  }
  const visible = pending.recent.filter((callback) => sameDecisionNotice(callback, latest));
  const target = latest.songId ?? latest.proposalId ?? latest.action;
  const song = latest.songId ? await readSongState(root, latest.songId).catch(() => undefined) : undefined;
  const buttons = visible.map((callback) => callback.label).join(" / ");
  const hiddenCount = Math.max(0, pending.count - visible.length);
  const nextButtons = visible.map((callback) => `「${callback.label}」`).join("または");
  const lines = [
    `- 最新の待ち: ${song ? `${song.songId} / ${song.title}` : target} / ${elapsedLabel(latest.createdAt, now)}`,
    `  ボタン: ${buttons}`,
    ...visible.map((callback) => `  - ${callback.label}: ${callback.effect}`),
    ...(song?.publicLinks?.[0] ? [`  URL: ${song.publicLinks[0]}`] : []),
    ...(hiddenCount > 0 ? ["- 古い待ち: 折りたたみ（/status では最新だけ表示）"] : [])
  ];
  return {
    lines,
    nextLine: `次: この /status 返信のボタンで${nextButtons || `「${latest.label}」`}を選ぶ。`
  };
}

async function listPendingProposalConfirmations(root: string, options: { limit: number; now: number }): Promise<PendingSummary> {
  const pending = await listPendingCallbackActionSummaries(root, {
    category: "working_confirmation",
    limit: Math.max(options.limit, 30),
    now: options.now
  });
  const recent = pending.recent.filter((entry) => entry.proposalId && isProposalConfirmationAction(entry.action));
  return {
    count: recent.length,
    recent: recent.slice(0, options.limit)
  };
}

export async function composeProducerStatus(root: string, options: ProducerStatusOptions = {}): Promise<string> {
  const now = options.now ?? Date.now();
  const [autopilot, pendingDecisions, pendingProposals, receive, songs] = await Promise.all([
    readAutopilotRunState(root),
    listPendingCallbackActionSummaries(root, {
      category: "producer_decision",
      limit: Math.max(options.limit ?? 6, 30),
      now
    }),
    listPendingProposalConfirmations(root, {
      limit: Math.max(options.limit ?? 6, 30),
      now
    }),
    readReceiveHealth(root),
    listSongStates(root)
  ]);
  const pending = pendingDecisions.count > 0 ? pendingDecisions : pendingProposals;
  const draftBox = await composeDraftBoxNextAction(root, { state: autopilot });
  const stage = options.autopilotStatus?.stage ?? autopilot.stage;
  const currentSongId = options.autopilotStatus?.currentSongId ?? autopilot.currentSongId;
  const rawBlockedReason = options.autopilotStatus?.blockedReason ?? autopilot.blockedReason;
  const song = currentSongId ? await readSongState(root, currentSongId).catch(() => undefined) : undefined;
  const latestWaiting = await latestWaitingLines(root, pending, now);
  const receiveLines = [
    receive.lastInboundAt
      ? `- 最後のメッセージ受信: ${elapsedLabel(receive.lastInboundAt, now)} (${new Date(receive.lastInboundAt).toISOString()})`
      : "- 最後のメッセージ受信: 記録なし",
    receive.lastCallbackAt
      ? `- 最後のボタン受信: ${elapsedLabel(receive.lastCallbackAt, now)} (${new Date(receive.lastCallbackAt).toISOString()})`
      : "- 最後のボタン受信: 記録なし"
  ];
  const publicLinks = song?.publicLinks?.length ? song.publicLinks : [];
  const awaitingUrlReady = songs.filter((candidate) => candidate.status === "suno_take_url_ready");
  const isPromptPackReadyWait = autopilot.suspendedAt === "prompt_pack_ready" && Boolean(currentSongId);
  const isPlanningSkeletonWait = autopilot.suspendedAt === "planning_skeleton_pending" && Boolean(currentSongId);
  const degradedLyricsSong = song?.degradedLyrics
    ? song
    : songs.find((candidate) => candidate.degradedLyrics && !["scheduled", "published", "archived", "discarded", "failed"].includes(candidate.status));
  const firstPending = pending.recent[0];
  const firstPendingIsUrlReadyDecision = firstPending?.songId
    ? awaitingUrlReady.some((candidate) => candidate.songId === firstPending.songId)
      && (firstPending.action === "song_archive" || firstPending.action === "song_discard")
    : false;
  const blockedReason = rawBlockedReason === "song_spawn_waiting_for_proposal"
    && pending.count === 0
    && draftBox.kind === "empty"
      ? undefined
      : rawBlockedReason;
  const nextLine = firstPendingIsUrlReadyDecision
    ? "次: この /status 返信のボタンで「採用して音源取得」か「破棄」を押す。採用するとSuno URLを保持し、音源ファイル取得を予約する。"
    : firstPending
    ? latestWaiting.nextLine ?? `次: ${firstPending.label} を押すと、${firstPending.effect}`
    : awaitingUrlReady.length > 0
      ? "次: この /status 返信のボタンで「採用して音源取得」か「破棄」を押す。採用するとSuno URLを保持し、音源ファイル取得を予約する。"
    : isPromptPackReadyWait
      ? "次: この /status 返信のボタンで「Suno 生成へ」「lyrics-suno.md を編集」「保留」を選ぶ。"
    : degradedLyricsSong
      ? "次: この /status 返信のボタンで「歌詞を作り直す」か「破棄」を選ぶ。"
    : isPlanningSkeletonWait
      ? "次: この /status 返信のボタンで「進める」「中止」「書き直す」を選ぶ。"
    : draftBox.nextAction;

  return [
    formatDraftBoxNextActionSection(draftBox, { includeNextAction: false }),
    "",
    "実行状態:",
    `- Stage: ${stage}`,
    `- song: ${song ? `${song.songId} / ${song.title}` : currentSongId ?? "なし"}`,
    autopilot.suspendedAt ? `- suspendedAt: ${autopilot.suspendedAt}` : undefined,
    blockedReason ? `- blocked: ${blockedReason}` : undefined,
    autopilot.hardStopReason ? `- hard stop: ${autopilot.hardStopReason}` : undefined,
    autopilot.lastError ? `- last error: ${autopilot.lastError}` : undefined,
    "",
    "受信 (Telegram):",
    ...receiveLines,
    "",
    "待ち:",
    ...latestWaiting.lines,
    ...(awaitingUrlReady.length > 0
      ? [
          "",
          "Suno URL 採用待ち:",
          ...awaitingUrlReady.slice(0, options.limit ?? 6).map((candidate) => [
            `- ${candidate.songId} / ${candidate.title}: ${candidate.publicLinks[0] ?? "URLなし"}`,
            "  操作: /status 返信の「採用して音源取得」で採用 + 音源取得予約。「破棄」でこの曲を閉じる。"
          ].join("\n"))
        ]
      : []),
    ...(isPromptPackReadyWait
      ? [
          "",
          "Suno 生成GO待ち:",
          `- ${currentSongId}${song?.title ? ` / ${song.title}` : ""}`,
          "  操作: /status 返信の「Suno 生成へ」で生成開始。「lyrics-suno.md を編集」で歌詞へ戻す。「保留」で止める。"
        ]
      : []),
    ...(degradedLyricsSong
      ? [
          "",
          "歌詞生成停止:",
          `- ${degradedLyricsSong.songId} / ${degradedLyricsSong.title}`,
          `  理由: ${degradedLyricsSong.lastReason ?? rawBlockedReason ?? "歌詞生成に失敗"}`,
          "  操作: /status 返信の「歌詞を作り直す」で再作成。「破棄」でこの曲を閉じる。"
        ]
      : []),
    ...(isPlanningSkeletonWait
      ? [
          "",
          "Planning補完待ち:",
          `- ${currentSongId}${song?.title ? ` / ${song.title}` : ""}`,
          `  不足: ${(rawBlockedReason ?? "").replace(/^planning_skeleton_incomplete:/, "") || "曲の骨組み"}`,
          "  操作: /status 返信の「進める」で補完案を反映。「中止」で見送り。「書き直す」で編集待ちにする。"
        ]
      : []),
    "",
    "公開 URL:",
    ...(publicLinks.length > 0 ? publicLinks.map((link) => `- ${link}`) : ["- なし"]),
    "",
    nextLine,
    dashboardLine(options.dashboardBaseUrl, song?.songId ?? currentSongId)
  ].filter((line): line is string => Boolean(line)).join("\n");
}
