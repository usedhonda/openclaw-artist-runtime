import type { RuntimeEvent, RuntimeEventBus } from "./runtimeEventBus.js";
import { TelegramClient, type TelegramFetch } from "./telegramClient.js";
import { generateArtistResponse, readArtistVoiceContext } from "./artistVoiceResponder.js";
import type { AiReviewProvider } from "../types.js";
import { registerCallbackAction } from "./callbackActionRegistry.js";
import { appendConversationTurn } from "./conversationalSession.js";
import { proposalForDetection } from "./songDistributionPoller.js";
import { isInlineButtonsEnabled, isXInlineButtonEnabled } from "./runtimeConfig.js";

export interface TelegramNotifierOptions {
  token: string;
  chatId: string | number;
  workspaceRoot?: string;
  aiReviewProvider?: AiReviewProvider;
  fetchImpl?: TelegramFetch;
}

export class TelegramNotifier {
  private readonly client: TelegramClient;

  constructor(private readonly options: TelegramNotifierOptions) {
    this.client = new TelegramClient(options.token, options.fetchImpl);
  }

  subscribe(bus: RuntimeEventBus): () => void {
    return bus.subscribe((event) => {
      void this.notify(event);
    });
  }

  async notify(event: RuntimeEvent): Promise<void> {
    const text = await formatRuntimeEvent(event, {
      workspaceRoot: this.options.workspaceRoot,
      aiReviewProvider: this.options.aiReviewProvider
    });
    const sent = await this.client.sendMessage(this.options.chatId, text);
    if (event.type === "song_take_completed") {
      await this.attachSongCompletionButtons(event, sent.message_id).catch(() => undefined);
    }
    if (event.type === "distribution_change_detected") {
      await this.attachDistributionButtons(event, sent.message_id, text).catch(() => undefined);
    }
    if (event.type === "artist_pulse_drafted") {
      await this.attachDailyVoiceButtons(event, sent.message_id).catch(() => undefined);
    }
    if (event.type === "song_spawn_proposed") {
      await this.attachSongSpawnButtons(event, sent.message_id).catch(() => undefined);
    }
    if (event.type === "planning_skeleton_incomplete") {
      await this.attachPlanningSkeletonButtons(event, sent.message_id, text).catch(() => undefined);
    }
    if (event.type === "take_select_low_score") {
      await this.attachTakeSelectButtons(event, sent.message_id).catch(() => undefined);
    }
  }

  private async attachSongCompletionButtons(event: Extract<RuntimeEvent, { type: "song_take_completed" }>, messageId: number): Promise<void> {
    if (!isInlineButtonsEnabled() || !this.options.workspaceRoot || typeof this.options.chatId !== "number") {
      return;
    }
    const actions = [
      registerCallbackAction(this.options.workspaceRoot, {
        action: "song_songbook_write",
        songId: event.songId,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      registerCallbackAction(this.options.workspaceRoot, {
        action: "song_skip",
        songId: event.songId,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      ...(isXInlineButtonEnabled() ? [registerCallbackAction(this.options.workspaceRoot, {
        action: "x_publish_prepare",
        songId: event.songId,
        draftUrl: event.urls[0],
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      })] : [])
    ];
    const [write, skip, xPrepare] = await Promise.all(actions);
    const buttons = [
      { text: "📝 SONGBOOK 反映", callback_data: `cb:${write.callbackId}` },
      { text: "⏸ 後で", callback_data: `cb:${skip.callbackId}` },
      ...(xPrepare ? [{ text: "▶ X 投稿準備", callback_data: `cb:${xPrepare.callbackId}` }] : [])
    ];
    await this.client.editMessageReplyMarkup(this.options.chatId, messageId, {
      inline_keyboard: [buttons]
    });
  }

  private async attachDistributionButtons(event: Extract<RuntimeEvent, { type: "distribution_change_detected" }>, messageId: number, text: string): Promise<void> {
    if (!isInlineButtonsEnabled() || !this.options.workspaceRoot || typeof this.options.chatId !== "number") {
      return;
    }
    const proposal = event.proposal ?? proposalForDetection({
      songId: event.songId,
      title: event.songId,
      platform: event.platform,
      url: event.url,
      detectedAt: new Date(event.timestamp).toISOString()
    });
    await appendConversationTurn(this.options.workspaceRoot, {
      chatId: this.options.chatId,
      userId: this.options.chatId,
      topic: { kind: "song", songId: event.songId },
      pendingChangeSet: proposal,
      turn: { role: "artist", text }
    });
    const [apply, skip] = await Promise.all([
      registerCallbackAction(this.options.workspaceRoot, {
        action: "dist_apply",
        proposalId: proposal.id,
        songId: event.songId,
        platform: event.platform,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      registerCallbackAction(this.options.workspaceRoot, {
        action: "dist_skip",
        proposalId: proposal.id,
        songId: event.songId,
        platform: event.platform,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      })
    ]);
    await this.client.editMessageReplyMarkup(this.options.chatId, messageId, {
      inline_keyboard: [[
        { text: "✓ 反映する", callback_data: `cb:${apply.callbackId}` },
        { text: "⏸ 後で", callback_data: `cb:${skip.callbackId}` }
      ]]
    });
  }

  private async attachDailyVoiceButtons(event: Extract<RuntimeEvent, { type: "artist_pulse_drafted" }>, messageId: number): Promise<void> {
    if (!isInlineButtonsEnabled() || !this.options.workspaceRoot || typeof this.options.chatId !== "number") {
      return;
    }
    const [publish, edit, cancel] = await Promise.all([
      registerCallbackAction(this.options.workspaceRoot, {
        action: "daily_voice_publish",
        draftText: event.draftText,
        draftHash: event.draftHash,
        draftCharCount: event.charCount,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      registerCallbackAction(this.options.workspaceRoot, {
        action: "daily_voice_edit",
        draftHash: event.draftHash,
        draftCharCount: event.charCount,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      registerCallbackAction(this.options.workspaceRoot, {
        action: "daily_voice_cancel",
        draftHash: event.draftHash,
        draftCharCount: event.charCount,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      })
    ]);
    await this.client.editMessageReplyMarkup(this.options.chatId, messageId, {
      inline_keyboard: [[
        { text: "▶ X 投稿", callback_data: `cb:${publish.callbackId}` },
        { text: "✏️ 修正", callback_data: `cb:${edit.callbackId}` },
        { text: "✗ 取消", callback_data: `cb:${cancel.callbackId}` }
      ]]
    });
  }

  private async attachSongSpawnButtons(event: Extract<RuntimeEvent, { type: "song_spawn_proposed" }>, messageId: number): Promise<void> {
    if (!isInlineButtonsEnabled() || !this.options.workspaceRoot || typeof this.options.chatId !== "number") {
      return;
    }
    const [inject, skip, edit] = await Promise.all([
      registerCallbackAction(this.options.workspaceRoot, {
        action: "song_spawn_inject",
        songId: event.candidateSongId,
        commissionBrief: event.brief,
        spawnReason: event.reason,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      registerCallbackAction(this.options.workspaceRoot, {
        action: "song_spawn_skip",
        songId: event.candidateSongId,
        commissionBrief: event.brief,
        spawnReason: event.reason,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      registerCallbackAction(this.options.workspaceRoot, {
        action: "song_spawn_edit",
        songId: event.candidateSongId,
        commissionBrief: event.brief,
        spawnReason: event.reason,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      })
    ]);
    await this.client.editMessageReplyMarkup(this.options.chatId, messageId, {
      inline_keyboard: [[
        { text: "✓ 進める", callback_data: `cb:${inject.callbackId}` },
        { text: "✗ 今は要らない", callback_data: `cb:${skip.callbackId}` },
        { text: "✏️ 修正", callback_data: `cb:${edit.callbackId}` }
      ]]
    });
  }

  private async attachPlanningSkeletonButtons(event: Extract<RuntimeEvent, { type: "planning_skeleton_incomplete" }>, messageId: number, text: string): Promise<void> {
    if (!isInlineButtonsEnabled() || !this.options.workspaceRoot || typeof this.options.chatId !== "number") {
      return;
    }
    await appendConversationTurn(this.options.workspaceRoot, {
      chatId: this.options.chatId,
      userId: this.options.chatId,
      topic: { kind: "song", songId: event.songId },
      pendingChangeSet: event.proposal,
      turn: { role: "artist", text }
    });
    const [apply, skip, edit] = await Promise.all([
      registerCallbackAction(this.options.workspaceRoot, {
        action: "planning_skeleton_apply",
        proposalId: event.proposal.id,
        songId: event.songId,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      registerCallbackAction(this.options.workspaceRoot, {
        action: "planning_skeleton_skip",
        proposalId: event.proposal.id,
        songId: event.songId,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      registerCallbackAction(this.options.workspaceRoot, {
        action: "planning_skeleton_edit",
        proposalId: event.proposal.id,
        songId: event.songId,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      })
    ]);
    await this.client.editMessageReplyMarkup(this.options.chatId, messageId, {
      inline_keyboard: [[
        { text: "✓ Yes", callback_data: `cb:${apply.callbackId}` },
        { text: "✗ No", callback_data: `cb:${skip.callbackId}` },
        { text: "✏️ Edit", callback_data: `cb:${edit.callbackId}` }
      ]]
    });
  }

  private async attachTakeSelectButtons(event: Extract<RuntimeEvent, { type: "take_select_low_score" }>, messageId: number): Promise<void> {
    if (!isInlineButtonsEnabled() || !this.options.workspaceRoot || typeof this.options.chatId !== "number") {
      return;
    }
    const [accept, regen, skip] = await Promise.all([
      registerCallbackAction(this.options.workspaceRoot, {
        action: "take_select_accept",
        songId: event.songId,
        selectedTakeId: event.bestTakeId,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      registerCallbackAction(this.options.workspaceRoot, {
        action: "take_select_regenerate",
        songId: event.songId,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      registerCallbackAction(this.options.workspaceRoot, {
        action: "take_select_skip",
        songId: event.songId,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      })
    ]);
    await this.client.editMessageReplyMarkup(this.options.chatId, messageId, {
      inline_keyboard: [[
        { text: "✓ 採用", callback_data: `cb:${accept.callbackId}` },
        { text: "↻ Suno再生成", callback_data: `cb:${regen.callbackId}` },
        { text: "⏸ 後で", callback_data: `cb:${skip.callbackId}` }
      ]]
    });
  }
}

async function artistReport(event: RuntimeEvent, fallback: string, options: Pick<TelegramNotifierOptions, "workspaceRoot" | "aiReviewProvider">): Promise<string> {
  if (!options.workspaceRoot) {
    return fallback;
  }
  const context = await readArtistVoiceContext(options.workspaceRoot, {
    topic: event.type,
    recentHistory: [fallback]
  });
  try {
    const response = await generateArtistResponse(fallback, context, {
      intent: "report",
      aiReviewProvider: options.aiReviewProvider
    });
    return response.text;
  } catch (error) {
    if (error instanceof Error && error.message.includes("secret_like_text")) {
      return fallback;
    }
    throw error;
  }
}

function dailyVoiceTitle(kind: Extract<RuntimeEvent, { type: "artist_pulse_drafted" }>["voiceKind"]): string {
  if (kind === "studio_whisper") {
    return "🎵 制作中のひとこと draft:";
  }
  if (kind === "musing") {
    return "💭 つぶやき draft:";
  }
  return "🔁 引用ポスト draft:";
}

export async function formatRuntimeEvent(
  event: RuntimeEvent,
  options: Pick<TelegramNotifierOptions, "workspaceRoot" | "aiReviewProvider"> = {}
): Promise<string> {
  switch (event.type) {
    case "autopilot_stage_changed":
      return `Autopilot stage: ${event.from ?? "unknown"} -> ${event.to}${event.songId ? ` (${event.songId})` : ""}`;
    case "take_imported":
      return `Take imported: ${event.songId} (${event.paths.length} path(s))`;
    case "autopilot_state_changed":
      return `Autopilot state: enabled=${event.enabled} paused=${event.paused}${event.reason ? ` reason=${event.reason}` : ""}`;
    case "song_take_completed":
      return artistReport(
        event,
        `Song take completed: ${event.songId}${event.selectedTakeId ? ` (${event.selectedTakeId})` : ""}${event.urls.length ? ` ${event.urls.join(" ")}` : ""}`,
        options
      );
    case "theme_generated":
      return artistReport(event, `Theme generated: ${event.theme}. Reason: ${event.reason}`, options);
    case "suno_budget_low":
      return artistReport(event, `Suno budget low: ${event.reason} (${event.used}/${event.limit})`, options);
    case "suno_generate_retry":
      return artistReport(event, `Suno generate retry: ${event.songId} retry=${event.retryCount} ${event.reason}${event.nextRetryAt ? ` next=${event.nextRetryAt}` : ""}`, options);
    case "suno_generate_failed":
      return artistReport(event, `Suno generate failed: ${event.songId} retry=${event.retryCount} ${event.reason}`, options);
    case "take_select_pending":
      return artistReport(event, `Take selection pending: ${event.songId} ${event.reason}`, options);
    case "take_select_low_score":
      return artistReport(event, `Take score is low: ${event.songId} best=${event.bestTakeId} score=${event.score}. ${event.reason}`, options);
    case "budget_exhausted":
      return artistReport(event, `Suno budget exhausted: ${event.reason} (${event.used}/${event.limit})`, options);
    case "bird_cooldown_triggered":
      return artistReport(event, `X observation cool-down triggered until ${event.cooldownUntil}: ${event.reason}`, options);
    case "distribution_change_detected":
      return artistReport(
        event,
        `Distribution change detected: ${event.platform} has a public link for ${event.songId}. ${event.url}${event.proposalId ? ` Proposal: ${event.proposalId}` : ""}`,
        options
      );
    case "song_songbook_written":
      return artistReport(event, `SONGBOOK updated: ${event.songId} is now marked published.`, options);
    case "song_publish_skipped":
      return artistReport(event, `Song completion skipped for now: ${event.songId}.`, options);
    case "artist_pulse_drafted":
      return [
        dailyVoiceTitle(event.voiceKind),
        "",
        event.draftText,
        "",
        "----------",
        `chars:${event.charCount} hash:${event.draftHash.slice(-8)}`,
        event.selectedSource ? `💭 観察元: ${event.selectedSource.author ? `@${event.selectedSource.author.replace(/^@/, "")}` : "anonymous"} (${event.selectedSource.url ? "URL あり" : "URL なし"})` : undefined,
        event.rationale ? `🎯 なぜ: ${event.rationale}` : undefined
      ].filter(Boolean).join("\n");
    case "song_spawn_proposed":
      return [
        "次の曲、こんな感じはどう?",
        "",
        `- songId: ${event.candidateSongId}`,
        `- title: ${event.brief.title}`,
        `- mood: ${event.brief.mood}`,
        `- tempo: ${event.brief.tempo}`,
        `- duration: ${event.brief.duration}`,
        `- reason: ${event.reason}`
      ].join("\n");
    case "planning_skeleton_incomplete":
      return [
        `Planning skeleton incomplete: ${event.songId}`,
        "",
        `missing: ${event.missing.join(", ")}`,
        "補完案を作った。進めるなら Yes。"
      ].join("\n");
    case "error":
      return `Runtime error: ${event.source} ${event.reason}${event.songId ? ` (${event.songId})` : ""}`;
  }
}
