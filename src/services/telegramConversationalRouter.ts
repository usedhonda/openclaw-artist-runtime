import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AiReviewProvider, AutopilotStatus } from "../types.js";
import { ArtistAutopilotService, readAutopilotRunState } from "./autopilotService.js";
import { listSongStates, readSongState } from "./artistState.js";
import { readArtistVoiceContext, generateArtistResponse } from "./artistVoiceResponder.js";
import {
  appendConversationTurn,
  createConversationalSession,
  handleProposalResponse,
  readConversationalSession,
  type ConversationalSession
} from "./conversationalSession.js";
import { proposeFreeformChangeSet, type ChangeSetProposal } from "./freeformChangesetProposer.js";
import { secretLikePattern } from "./personaMigrator.js";
import { handleCommission } from "./songCommissionHandler.js";
import { isCommissionConfigured, readResolvedConfig } from "./runtimeConfig.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";

export interface TelegramConversationalRouteInput {
  text: string;
  fromUserId: number;
  chatId: number;
  workspaceRoot: string;
  aiReviewProvider?: AiReviewProvider;
  autopilotStatus?: AutopilotStatus;
}

export interface TelegramConversationalRouteResult {
  responseText: string;
  shouldStoreFreeText: boolean;
  proposalButtons?: TelegramProposalButtonsRequest;
}

export interface TelegramProposalButtonsRequest {
  proposalId: string;
}

function stripCommand(text: string): string {
  return text.replace(/^\/(persona|song|talk|commission)\b/i, "").trim();
}

function forbiddenTopic(text: string, topics: string[]): string | undefined {
  const normalized = text.toLowerCase();
  return topics.find((topic) => topic.trim() && normalized.includes(topic.trim().toLowerCase()));
}

function songCreateHint(text: string): string | undefined {
  const slash = text.match(/^\/song\s+create(?:\s+([\s\S]*))?$/i);
  if (slash) {
    return slash[1]?.trim() || undefined;
  }
  const natural = text.match(/(?:曲作って|新曲|make a song|produce|create song|作品作って)\s*([\s\S]*)/i);
  return natural ? natural[1]?.trim() || undefined : undefined;
}

function isSongCreate(text: string): boolean {
  return /^\/song\s+create\b/i.test(text) || /曲作って|新曲|make a song|produce|create song|作品作って/i.test(text);
}

function affirmative(text: string): boolean {
  return /^\/?(yes|y|ok|confirm|one|はい|お願い|やって)\b/i.test(text);
}

function negative(text: string): boolean {
  return /^\/?(no|n|cancel|やめ|不要|違う)\b/i.test(text);
}

function logConversationalSideEffectFailure(context: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`[telegram-conversation] ${context} failed: ${reason}`);
}

function formatChangeSet(proposal: ChangeSetProposal): string {
  return [
    proposal.summary,
    ...proposal.fields.slice(0, 8).map((field) => `- ${field.field}: ${field.proposedValue}`),
    "反映するなら /yes、やめるなら /no。直すなら /edit <field> <value>。"
  ].join("\n");
}

function formatCommissionProposal(proposal: ChangeSetProposal): string {
  return [
    "作る内容の確認:",
    ...proposal.fields.slice(0, 8).map((field) => `- ${field.field}: ${field.proposedValue}`),
    "",
    "これで曲作りに進める?",
    "[Yes] [No] [Edit]"
  ].join("\n");
}

function formatSongCreateAccepted(hint?: string): string {
  return [
    hint ? `作り始めた。芯: ${hint}` : "作り始めた。観察から曲に起こす。",
    "進捗は /status。完成、確認待ち、Suno 停止はここに出す。"
  ].join("\n");
}

function isClosedForManualCreate(status: string): boolean {
  return ["scheduled", "published", "archived", "discarded", "failed"].includes(status);
}

async function activeSongForManualCreate(root: string): Promise<{ songId: string; title?: string; status?: string } | undefined> {
  const state = await readAutopilotRunState(root).catch(() => undefined);
  if (state?.currentSongId) {
    const current = await readSongState(root, state.currentSongId).catch(() => undefined);
    if (current && !isClosedForManualCreate(current.status)) {
      return { songId: current.songId, title: current.title, status: current.status };
    }
  }
  const active = (await listSongStates(root).catch(() => []))
    .find((song) => !isClosedForManualCreate(song.status));
  return active ? { songId: active.songId, title: active.title, status: active.status } : undefined;
}

async function proposeFromConversation(root: string, text: string, session: ConversationalSession, provider?: AiReviewProvider): Promise<ChangeSetProposal | undefined> {
  if (!/(変え|変更|直し|update|edit|persona|歌詞|lyrics|曲|song)/i.test(text)) {
    return undefined;
  }
  const domain = session.topic.kind === "song" ? "song" : "persona";
  const [artistMd, soulMd, songMd, briefMd, songbookEntry, currentState] = await Promise.all([
    readFile(join(root, "ARTIST.md"), "utf8").catch(() => ""),
    readFile(join(root, "SOUL.md"), "utf8").catch(() => ""),
    session.topic.songId ? readFile(join(root, "songs", session.topic.songId, "song.md"), "utf8").catch(() => "") : Promise.resolve(""),
    session.topic.songId ? readFile(join(root, "songs", session.topic.songId, "brief.md"), "utf8").catch(() => "") : Promise.resolve(""),
    readFile(join(root, "artist", "SONGBOOK.md"), "utf8").catch(() => ""),
    readFile(join(root, "artist", "CURRENT_STATE.md"), "utf8").catch(() => "")
  ]);
  return proposeFreeformChangeSet({
    domain,
    root,
    userMessage: text,
    aiReviewProvider: provider,
    songId: session.topic.songId,
    artistMd,
    soulMd,
    songMd,
    briefMd,
    songbookEntry,
    currentState
  });
}

async function respondAsArtist(root: string, text: string, session: ConversationalSession, provider?: AiReviewProvider): Promise<string> {
  const context = await readArtistVoiceContext(root, {
    topic: session.topic.kind,
    recentHistory: session.history.map((turn) => `${turn.role}: ${turn.text}`)
  });
  return (await generateArtistResponse(text, context, { intent: "discuss", aiReviewProvider: provider })).text;
}

export async function routeTelegramConversation(input: TelegramConversationalRouteInput): Promise<TelegramConversationalRouteResult> {
  const text = input.text.trim();
  if (secretLikePattern.test(text)) {
    return { responseText: "それ、秘密っぽい文字列が混じってる。別の言い方で投げてくれ。", shouldStoreFreeText: true };
  }
  if (/^\/commission\b/i.test(text)) {
    const config = await readResolvedConfig(input.workspaceRoot);
    if (!isCommissionConfigured(config)) {
      return { responseText: "commission intake is disabled. OPENCLAW_COMMISSION_ENABLED=on で開ける。", shouldStoreFreeText: false };
    }
    const brief = stripCommand(text);
    if (!brief) {
      return { responseText: "Usage: /commission <曲のお題・方向性>", shouldStoreFreeText: false };
    }
    const blockedTopic = forbiddenTopic(brief, config.safety.forbiddenTopics);
    if (blockedTopic) {
      return { responseText: `commission blocked by forbidden topic: ${blockedTopic}`, shouldStoreFreeText: false };
    }
    const result = await handleCommission(input.workspaceRoot, {
      brief,
      aiReviewProvider: input.aiReviewProvider
    });
    await appendConversationTurn(input.workspaceRoot, {
      chatId: input.chatId,
      userId: input.fromUserId,
      topic: { kind: "song", songId: result.commissionBrief.songId },
      pendingChangeSet: result.proposal,
      turn: { role: "artist", text: formatCommissionProposal(result.proposal) }
    });
    return {
      responseText: formatCommissionProposal(result.proposal),
      shouldStoreFreeText: true,
      proposalButtons: { proposalId: result.proposal.id }
    };
  }
  const existing = await readConversationalSession(input.workspaceRoot, input.chatId, input.fromUserId);
  const topic = text.startsWith("/song")
    ? { kind: "song" as const, songId: text.match(/^\/song\s+([^\s]+)/i)?.[1] === "create" ? undefined : text.match(/^\/song\s+([^\s]+)/i)?.[1] }
    : text.startsWith("/persona")
      ? { kind: "persona" as const }
      : existing?.topic ?? { kind: "free" as const };
  let session = existing ?? await createConversationalSession(input.workspaceRoot, {
    chatId: input.chatId,
    userId: input.fromUserId,
    topic
  });
  session = { ...session, topic };

  if (isSongCreate(text)) {
    const activeSong = await activeSongForManualCreate(input.workspaceRoot);
    if (activeSong) {
      return {
        responseText: [
          `いま ${activeSong.songId}${activeSong.title ? ` / ${activeSong.title}` : ""} を作っている。`,
          activeSong.status ? `status: ${activeSong.status}` : undefined,
          "新しい曲は今の制作か採用/破棄待ちが閉じてからにする。進捗とボタンは /status。"
        ].filter((line): line is string => Boolean(line)).join("\n"),
        shouldStoreFreeText: false
      };
    }
    const hint = songCreateHint(text);
    void new ArtistAutopilotService().runCycle({
      workspaceRoot: input.workspaceRoot,
      manualSeed: { hint: hint ?? "" }
    }).catch((error) => {
      const reason = error instanceof Error ? error.message : String(error);
      logConversationalSideEffectFailure("manual song create runCycle", error);
      emitRuntimeEvent({
        type: "error",
        source: "telegram_manual_song_create",
        reason,
        timestamp: Date.now()
      });
    });
    const response = formatSongCreateAccepted(hint);
    await appendConversationTurn(input.workspaceRoot, { chatId: input.chatId, userId: input.fromUserId, topic, turn: { role: "artist", text: response } });
    return { responseText: response, shouldStoreFreeText: true };
  }

  if (session.pendingChangeSet && affirmative(text)) {
    const result = await handleProposalResponse(input.workspaceRoot, {
      proposalId: session.pendingChangeSet.id,
      action: "yes",
      actor: { kind: "telegram_text", chatId: input.chatId, userId: input.fromUserId }
    });
    return {
      responseText: result.message,
      shouldStoreFreeText: false
    };
  }
  if (session.pendingChangeSet && negative(text)) {
    const result = await handleProposalResponse(input.workspaceRoot, {
      proposalId: session.pendingChangeSet.id,
      action: "no",
      actor: { kind: "telegram_text", chatId: input.chatId, userId: input.fromUserId }
    });
    return { responseText: result.message, shouldStoreFreeText: false };
  }
  const edit = text.match(/^\/edit\s+(\S+)\s+([\s\S]+)$/i);
  if (session.pendingChangeSet && edit) {
    const [, field, value] = edit;
    const result = await handleProposalResponse(input.workspaceRoot, {
      proposalId: session.pendingChangeSet.id,
      action: "edit",
      actor: { kind: "telegram_text", chatId: input.chatId, userId: input.fromUserId },
      fieldUpdates: { [field]: value }
    });
    const proposal = result.proposal ?? session.pendingChangeSet;
    return { responseText: formatChangeSet(proposal), shouldStoreFreeText: false };
  }

  const cleanText = stripCommand(text) || text;
  await appendConversationTurn(input.workspaceRoot, { chatId: input.chatId, userId: input.fromUserId, topic, turn: { role: "user", text: cleanText } });
  session = await readConversationalSession(input.workspaceRoot, input.chatId, input.fromUserId) ?? session;
  const proposal = await proposeFromConversation(input.workspaceRoot, cleanText, session, input.aiReviewProvider);
  const artistText = await respondAsArtist(input.workspaceRoot, cleanText, session, input.aiReviewProvider);
  if (proposal && proposal.fields.length > 0) {
    await appendConversationTurn(input.workspaceRoot, {
      chatId: input.chatId,
      userId: input.fromUserId,
      topic,
      pendingChangeSet: proposal,
      turn: { role: "artist", text: artistText }
    });
    return {
      responseText: `${artistText}\n\n${formatChangeSet(proposal)}`,
      shouldStoreFreeText: true,
      proposalButtons: { proposalId: proposal.id }
    };
  }
  await appendConversationTurn(input.workspaceRoot, { chatId: input.chatId, userId: input.fromUserId, topic, turn: { role: "artist", text: artistText } });
  return { responseText: artistText, shouldStoreFreeText: true };
}

export function isConversationalSongCreate(text: string): boolean {
  return isSongCreate(text);
}
