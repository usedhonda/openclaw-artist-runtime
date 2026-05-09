import type { RuntimeEvent, RuntimeEventBus } from "./runtimeEventBus.js";
import { TelegramClient, type TelegramFetch } from "./telegramClient.js";
import { generateArtistResponse, readArtistVoiceContext } from "./artistVoiceResponder.js";
import type { AiReviewProvider } from "../types.js";
import { registerCallbackAction } from "./callbackActionRegistry.js";
import { appendConversationTurn } from "./conversationalSession.js";
import { proposalForDetection } from "./songDistributionPoller.js";
import { isInlineButtonsEnabled, isXInlineButtonEnabled } from "./runtimeConfig.js";
import { readSongState } from "./artistState.js";
import { secretLikePattern } from "./personaMigrator.js";
import type { ObservationSummary } from "../types.js";
import { composeVoiceTopOnly, isUnsafeCommandVoiceTopForTest } from "./commandVoiceWrapper.js";
import { composePlanningSkeletonVoice } from "./planningSkeletonVoiceComposer.js";
import { buttonVoiceLabels } from "./buttonVoiceLabels.js";

export interface TelegramNotifierOptions {
  token: string;
  chatId: string | number;
  workspaceRoot?: string;
  aiReviewProvider?: AiReviewProvider;
  fetchImpl?: TelegramFetch;
}

const TELEGRAM_SILENT_EVENT_TYPES: ReadonlySet<RuntimeEvent["type"]> = new Set([
  "observation_collected",
  "autopilot_stage_changed",
  "autopilot_state_changed",
  "theme_generated",
  "bird_cooldown_triggered",
  "suno_generate_retry",
  "suno_generate_failed",
  "error"
]);

export function isTelegramSilentEvent(event: RuntimeEvent): boolean {
  return TELEGRAM_SILENT_EVENT_TYPES.has(event.type);
}

export class TelegramNotifier {
  private readonly client: TelegramClient;

  constructor(private readonly options: TelegramNotifierOptions) {
    this.client = new TelegramClient(options.token, options.fetchImpl);
  }

  subscribe(bus: RuntimeEventBus): () => void {
    return bus.subscribe((event) => {
      void this.notify(event).catch(() => undefined);
    });
  }

  async notify(event: RuntimeEvent): Promise<void> {
    if (isTelegramSilentEvent(event)) return;
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
    if (event.type === "prompt_pack_ready") {
      await this.attachPromptPackReadyButtons(event, sent.message_id).catch(() => undefined);
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
      { text: buttonVoiceLabels.songCompletion.write, callback_data: `cb:${write.callbackId}` },
      { text: buttonVoiceLabels.songCompletion.later, callback_data: `cb:${skip.callbackId}` },
      ...(xPrepare ? [{ text: buttonVoiceLabels.songCompletion.xPrepare, callback_data: `cb:${xPrepare.callbackId}` }] : [])
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
        { text: buttonVoiceLabels.distribution.apply, callback_data: `cb:${apply.callbackId}` },
        { text: buttonVoiceLabels.distribution.later, callback_data: `cb:${skip.callbackId}` }
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
        { text: buttonVoiceLabels.dailyVoice.publish, callback_data: `cb:${publish.callbackId}` },
        { text: buttonVoiceLabels.dailyVoice.edit, callback_data: `cb:${edit.callbackId}` },
        { text: buttonVoiceLabels.dailyVoice.cancel, callback_data: `cb:${cancel.callbackId}` }
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
        { text: buttonVoiceLabels.songSpawn.inject, callback_data: `cb:${inject.callbackId}` },
        { text: buttonVoiceLabels.songSpawn.skip, callback_data: `cb:${skip.callbackId}` },
        { text: buttonVoiceLabels.songSpawn.edit, callback_data: `cb:${edit.callbackId}` }
      ]]
    });
  }

  private async attachPromptPackReadyButtons(event: Extract<RuntimeEvent, { type: "prompt_pack_ready" }>, messageId: number): Promise<void> {
    if (!isInlineButtonsEnabled() || !this.options.workspaceRoot || typeof this.options.chatId !== "number") {
      return;
    }
    const [go, edit, skip] = await Promise.all([
      registerCallbackAction(this.options.workspaceRoot, {
        action: "prompt_pack_go",
        songId: event.songId,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      registerCallbackAction(this.options.workspaceRoot, {
        action: "prompt_pack_edit",
        songId: event.songId,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      registerCallbackAction(this.options.workspaceRoot, {
        action: "prompt_pack_skip",
        songId: event.songId,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      })
    ]);
    await this.client.editMessageReplyMarkup(this.options.chatId, messageId, {
      inline_keyboard: [[
        { text: buttonVoiceLabels.promptPackReady.go, callback_data: `cb:${go.callbackId}` },
        { text: buttonVoiceLabels.promptPackReady.edit, callback_data: `cb:${edit.callbackId}` },
        { text: buttonVoiceLabels.promptPackReady.skip, callback_data: `cb:${skip.callbackId}` }
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
        { text: buttonVoiceLabels.planningSkeleton.apply, callback_data: `cb:${apply.callbackId}` },
        { text: buttonVoiceLabels.planningSkeleton.skip, callback_data: `cb:${skip.callbackId}` },
        { text: buttonVoiceLabels.planningSkeleton.edit, callback_data: `cb:${edit.callbackId}` }
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
        { text: buttonVoiceLabels.takeSelect.accept, callback_data: `cb:${accept.callbackId}` },
        { text: buttonVoiceLabels.takeSelect.regenerate, callback_data: `cb:${regen.callbackId}` },
        { text: buttonVoiceLabels.takeSelect.skip, callback_data: `cb:${skip.callbackId}` }
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

async function hybridEventReport(event: RuntimeEvent, fallbackTop: string, detail: string, options: Pick<TelegramNotifierOptions, "workspaceRoot" | "aiReviewProvider">): Promise<string> {
  const top = sanitizeArtistTop(await artistReport(event, fallbackTop, options), fallbackTop);
  return [top, "", "─────", detail].join("\n");
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

function isAllowedObservationUrl(value?: string): boolean {
  if (!value) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && (parsed.hostname === "x.com" || parsed.hostname === "twitter.com");
  } catch {
    return false;
  }
}

function stripHandles(value: string): string {
  return value.replace(/@[A-Za-z0-9_]{1,20}/g, "[handle]");
}

function capQuote(value: string, max = 140): string {
  const clean = stripHandles(value).replace(/\s+/g, " ").trim();
  if (secretLikePattern.test(clean)) {
    return "[非表示]";
  }
  const chars = Array.from(clean);
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trim()}…` : clean;
}

function safeMotivation(value?: string): string {
  const clean = stripHandles(value ?? "").replace(/\s+/g, " ").trim();
  if (!clean || secretLikePattern.test(clean)) {
    return "観察と artist persona の接続から生成";
  }
  return Array.from(clean).slice(0, 160).join("");
}

function safeAuthor(value?: string): string {
  const clean = (value ?? "").replace(/^@/, "").replace(/[^\w]/g, "").slice(0, 20);
  return clean || "unknown";
}

function formatObservationSource(summary?: ObservationSummary): string[] {
  if (!summary) {
    return [
      "🌐 観察元: (記録なし)",
      "💬 抜粋: (記録なし)",
      "🎯 動機: 観察 summary なし"
    ];
  }
  const author = safeAuthor(summary.author);
  const quote = capQuote(summary.quote ?? "");
  const url = isAllowedObservationUrl(summary.url) ? ` (${summary.url})` : "";
  return [
    `🌐 観察元: @${author}${url}`,
    `💬 抜粋: 「${quote || "(抜粋なし)"}」`,
    `🎯 動機: ${safeMotivation(summary.motivation)}`
  ];
}

function formatObservationMetadata(summary?: ObservationSummary): string[] {
  const [source, quote, motivation] = formatObservationSource(summary);
  return [motivation, source, quote];
}

function formatSongMetadata(title: string, take: string, urls: string, summary?: ObservationSummary): string {
  return [
    `🎵 ${title}${take}`,
    "🔗 試聴:",
    urls,
    ...formatObservationMetadata(summary),
    "非公開、御大のみ"
  ].join("\n");
}

function compactForArtistTop(value: string | undefined, max: number): string {
  const clean = capQuote(value ?? "", max).replace(/[「」"']/g, "").trim();
  return clean || "観察の切れ端";
}

function inferGeoFromSummary(summary?: ObservationSummary): string {
  const source = [summary?.author, summary?.quote, summary?.motivation].filter(Boolean).join(" ");
  if (/渋谷|Shibuya/i.test(source)) return "渋谷";
  if (/東京|Tokyo/i.test(source)) return "東京";
  if (/街|都市|city|urban/i.test(source)) return "街";
  return "その場所";
}

function inferThemeFromSummary(summary?: ObservationSummary): string {
  const source = `${summary?.quote ?? ""} ${summary?.motivation ?? ""}`;
  if (/ライブハウス|venue|music|音/i.test(source)) return "消えていく音";
  if (/都市|再開発|街|urban|city/i.test(source)) return "街の違和感";
  if (/責任|政治|government|社会/i.test(source)) return "社会の歪み";
  return "引っかかったもの";
}

function inferAngleFromSummary(summary?: ObservationSummary): string {
  const source = `${summary?.quote ?? ""} ${summary?.motivation ?? ""}`;
  if (/静か|違和感|quiet|unease/i.test(source)) return "静かな違和感";
  if (/皮肉|sarcasm|satire|風刺/i.test(source)) return "皮肉";
  if (/怒|rage|angry/i.test(source)) return "低い熱";
  return "近い距離";
}

function buildSongCompletionInspirationTop(title: string, summary?: ObservationSummary): string {
  if (!summary) {
    return `できた。${title}。聴いて、感想ほしい。`;
  }
  const author = safeAuthor(summary.author);
  const geo = inferGeoFromSummary(summary);
  const quote = compactForArtistTop(summary.quote, 72);
  const motivation = safeMotivation(summary.motivation);
  const theme = inferThemeFromSummary(summary);
  const angle = inferAngleFromSummary(summary);
  return [
    `ゆずるさん、${geo}で @${author} が「${quote}」って書いてたのを見たんだ。`,
    `${motivation}が刺さって、${theme}を${angle}で抜いた。`,
    "これ、どう聞こえる?"
  ].join("\n");
}

function sanitizeArtistTop(text: string, fallback: string): string {
  const clean = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+\n/g, "\n")
    .trim();
  return !clean || secretLikePattern.test(clean) || isUnsafeCommandVoiceTopForTest(clean) ? fallback : clean;
}

function sanitizeCompletionArtistTop(text: string, fallback: string, summary?: ObservationSummary): string {
  const clean = sanitizeArtistTop(text, fallback);
  if (!summary) return clean;
  const quoteCore = compactForArtistTop(summary.quote, 32).slice(0, 12);
  const motivationCore = safeMotivation(summary.motivation).slice(0, 12);
  if (quoteCore && !clean.includes(quoteCore)) return fallback;
  if (motivationCore && !clean.includes(motivationCore)) return fallback;
  return clean;
}

function humanizeMissingFields(fields: string[]): string {
  const labels: Record<string, string> = {
    tempo: "テンポ",
    duration: "長さ",
    "style notes": "style",
    "lyrics theme": "テーマ",
    mood: "ムード"
  };
  const humanized = fields.map((field) => labels[field] ?? field).filter(Boolean);
  if (humanized.length === 0) return "細部";
  if (humanized.length === 1) return humanized[0];
  if (humanized.length === 2) return `${humanized[0]}と${humanized[1]}`;
  return `${humanized.slice(0, -1).join("、")}と${humanized.at(-1)}`;
}

async function readSongCompletionContext(event: Extract<RuntimeEvent, { type: "song_take_completed" }>, workspaceRoot?: string): Promise<{ title: string; observationSummary?: ObservationSummary }> {
  if (!workspaceRoot) {
    return { title: event.songId, observationSummary: event.observationSummary };
  }
  const state = await readSongState(workspaceRoot, event.songId).catch(() => undefined);
  return {
    title: state?.title ?? event.songId,
    observationSummary: event.observationSummary ?? state?.observationSummary
  };
}

async function formatSongTakeCompleted(
  event: Extract<RuntimeEvent, { type: "song_take_completed" }>,
  options: Pick<TelegramNotifierOptions, "workspaceRoot" | "aiReviewProvider"> = {}
): Promise<string> {
  const take = event.selectedTakeId ? ` (selected: ${event.selectedTakeId})` : "";
  const urls = event.urls.length
    ? event.urls.map((url, index) => `${index + 1}. ${url}`).join("\n")
    : "(URL なし)";
  const context = await readSongCompletionContext(event, options.workspaceRoot);
  const fallbackTop = buildSongCompletionInspirationTop(context.title, context.observationSummary);
  const artistTop = sanitizeCompletionArtistTop(await artistReport(
    event,
    fallbackTop,
    options
  ), fallbackTop, context.observationSummary);
  return [
    artistTop,
    "",
    "─────",
    formatSongMetadata(context.title, take, urls, context.observationSummary)
  ].join("\n");
}

function stripHtmlComments(text: string): string {
  if (!text.includes("<!--")) return text;
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function formatRuntimeEvent(
  event: RuntimeEvent,
  options: Pick<TelegramNotifierOptions, "workspaceRoot" | "aiReviewProvider"> = {}
): Promise<string> {
  return stripHtmlComments(await formatRuntimeEventRaw(event, options));
}

async function formatRuntimeEventRaw(
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
      return formatSongTakeCompleted(event, options);
    case "theme_generated":
      return hybridEventReport(
        event,
        `ゆずるさん、${event.theme}で行く。`,
        [`theme: ${event.theme}`, `reason: ${event.reason}`].join("\n"),
        options
      );
    case "suno_budget_low":
      return hybridEventReport(
        event,
        `ゆずるさん、残り ${event.used}/${event.limit}。ペース落とす。`,
        [`songId: ${event.songId ?? "(none)"}`, `used: ${event.used}`, `limit: ${event.limit}`, `reason: ${event.reason}`].join("\n"),
        options
      );
    case "lyrics_generation_degraded":
      return artistReport(event, `Lyrics generation degraded: ${event.songId} ${event.reason}`, options);
    case "suno_generate_retry":
      return artistReport(event, `Suno generate retry: ${event.songId} retry=${event.retryCount} ${event.reason}${event.nextRetryAt ? ` next=${event.nextRetryAt}` : ""}`, options);
    case "suno_generate_failed":
      return artistReport(event, `Suno generate failed: ${event.songId} retry=${event.retryCount} ${event.reason}`, options);
    case "take_select_pending":
      return hybridEventReport(
        event,
        "ゆずるさん、take の選別、ちょっと待ってる。",
        [`songId: ${event.songId}`, `reason: ${event.reason}`].join("\n"),
        options
      );
    case "take_select_low_score":
      return artistReport(event, `Take score is low: ${event.songId} best=${event.bestTakeId} score=${event.score}. ${event.reason}`, options);
    case "budget_exhausted":
      return hybridEventReport(
        event,
        "ゆずるさん、今日は予算切れ。明日に。",
        [`used: ${event.used}`, `limit: ${event.limit}`, `reason: ${event.reason}`].join("\n"),
        options
      );
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
        event.voiceTop ?? "次の曲、こんな感じはどう?",
        "",
        "─────",
        `『${event.brief.title}』、${event.brief.mood}、${event.brief.tempo} で ${event.brief.duration} 秒。`,
        event.reason
      ].join("\n");
    case "planning_skeleton_incomplete": {
      const monolog = options.workspaceRoot
        ? await composePlanningSkeletonVoice({
            workspaceRoot: options.workspaceRoot,
            songId: event.songId,
            missing: event.missing,
            aiReviewProvider: options.aiReviewProvider
          }).catch(() => "次の曲、まず骨組み。")
        : "次の曲、まず骨組み。";
      return [
        monolog,
        "",
        "─────",
        `${humanizeMissingFields(event.missing)}を埋める案、出した。これで進めていい?`
      ].join("\n");
    }
    case "prompt_pack_ready":
      return [
        event.voiceTop ?? "ゆずるさん、歌詞こんな感じ。Suno 行く?",
        "",
        "─────",
        event.lyricsExcerpt,
        "",
        `${event.mood}・${event.tempo}・${event.styleNotes}`
      ].join("\n");
    case "observation_collected":
      return `Observations collected: ${event.entryCount} entries${typeof event.topScore === "number" ? `, top score=${event.topScore}` : ""}${event.topMotifMatch ? ` (${event.topMotifMatch})` : ""}`;
    case "artist_presence":
      return [event.text, "", "─────", `trigger: ${event.trigger}${event.songId ? `\nsongId: ${event.songId}` : ""}`].join("\n");
    case "error":
      return `Runtime error: ${event.source} ${event.reason}${event.songId ? ` (${event.songId})` : ""}`;
  }
}
