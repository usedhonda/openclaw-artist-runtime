import { readSongState } from "./artistState.js";
import { readAutopilotRunState } from "./autopilotService.js";
import { listPendingCallbackActionSummaries } from "./callbackActionRegistry.js";
import { composeDraftBoxNextAction, formatDraftBoxNextActionSection } from "./draftBoxNextAction.js";
import { readReceiveHealth } from "./receiveHealthService.js";
import type { AutopilotStatus } from "../types.js";

export interface ProducerStatusOptions {
  now?: number;
  dashboardBaseUrl?: string;
  limit?: number;
  autopilotStatus?: AutopilotStatus;
}

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

export async function composeProducerStatus(root: string, options: ProducerStatusOptions = {}): Promise<string> {
  const now = options.now ?? Date.now();
  const [autopilot, pending, receive] = await Promise.all([
    readAutopilotRunState(root),
    listPendingCallbackActionSummaries(root, {
      category: "producer_decision",
      limit: options.limit ?? 6,
      now
    }),
    readReceiveHealth(root)
  ]);
  const draftBox = await composeDraftBoxNextAction(root, { state: autopilot });
  const stage = options.autopilotStatus?.stage ?? autopilot.stage;
  const currentSongId = options.autopilotStatus?.currentSongId ?? autopilot.currentSongId;
  const blockedReason = options.autopilotStatus?.blockedReason ?? autopilot.blockedReason;
  const song = currentSongId ? await readSongState(root, currentSongId).catch(() => undefined) : undefined;
  const waitingLines = pending.recent.length === 0
    ? ["- 待ち callback: なし"]
    : pending.recent.map((callback) => [
        `- ${callback.label}: ${callback.songId ?? callback.proposalId ?? callback.action} / ${elapsedLabel(callback.createdAt, now)}`,
        `  効果: ${callback.effect}`
      ].join("\n"));
  const receiveLines = [
    receive.lastInboundAt
      ? `- 最後のメッセージ受信: ${elapsedLabel(receive.lastInboundAt, now)} (${new Date(receive.lastInboundAt).toISOString()})`
      : "- 最後のメッセージ受信: 記録なし",
    receive.lastCallbackAt
      ? `- 最後のボタン受信: ${elapsedLabel(receive.lastCallbackAt, now)} (${new Date(receive.lastCallbackAt).toISOString()})`
      : "- 最後のボタン受信: 記録なし"
  ];
  const publicLinks = song?.publicLinks?.length ? song.publicLinks : [];
  const nextLine = pending.recent[0]
    ? `次: ${pending.recent[0].label} を押すと、${pending.recent[0].effect}`
    : draftBox.nextAction;

  return [
    formatDraftBoxNextActionSection(draftBox),
    "",
    "現在地:",
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
    ...waitingLines,
    "",
    "公開 URL:",
    ...(publicLinks.length > 0 ? publicLinks.map((link) => `- ${link}`) : ["- なし"]),
    "",
    nextLine,
    dashboardLine(options.dashboardBaseUrl, song?.songId ?? currentSongId)
  ].filter((line): line is string => Boolean(line)).join("\n");
}
