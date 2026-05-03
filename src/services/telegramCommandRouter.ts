import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AiReviewProvider, AutopilotStatus } from "../types.js";
import { AutopilotControlService } from "./autopilotControlService.js";
import { formatDebugAiReviewResult, reviewSongDebugMaterial } from "./debugAiReviewService.js";
import { auditPersonaCompleteness, formatPersonaAuditReport, type PersonaFieldAudit } from "./personaFieldAuditor.js";
import { readArtistPersonaSummary } from "./personaFileBuilder.js";
import { proposePersonaFields } from "./personaProposer.js";
import { getSongDetail, listRecentSongs } from "./songQueryService.js";
import { readSongMaterial } from "./songMaterialReader.js";
import { createTelegramPersonaSession, handleTelegramPersonaSessionMessage } from "./telegramPersonaSession.js";
import { formatPersonaMigratePlan, planPersonaMigrate } from "./personaMigrator.js";
import { isLegacyWizardEnabled } from "./runtimeConfig.js";
import { readSoulPersonaSummary } from "./soulFileBuilder.js";
import { isConversationalSongCreate, routeTelegramConversation, type TelegramProposalButtonsRequest } from "./telegramConversationalRouter.js";
import { readObservationsReport, type ObservationReport } from "./xObservationCollector.js";

export type TelegramCommandKind =
  | "help"
  | "status"
  | "songs"
  | "song"
  | "regen"
  | "review"
  | "pause"
  | "resume"
  | "setup"
  | "persona"
  | "observations"
  | "unknown"
  | "free_text";

export interface TelegramRouteInput {
  text: string;
  fromUserId: number;
  chatId: number;
  workspaceRoot?: string;
  autopilotStatus?: AutopilotStatus;
  aiReviewProvider?: AiReviewProvider;
}

export interface TelegramRouteResult {
  kind: TelegramCommandKind;
  responseText: string;
  shouldStoreFreeText: boolean;
  proposalButtons?: TelegramProposalButtonsRequest;
}

function inboxPath(root: string): string {
  return join(root, "runtime", "telegram-inbox.jsonl");
}

function formatStatus(status?: AutopilotStatus): string {
  if (!status) {
    return "Autopilot status unavailable.";
  }
  return [
    `Autopilot: ${status.enabled ? "enabled" : "disabled"}${status.dryRun ? " (dry-run)" : ""}`,
    `Stage: ${status.stage}`,
    `Next: ${status.nextAction}`,
    status.currentSongId ? `Song: ${status.currentSongId}` : undefined,
    status.blockedReason ? `Blocked: ${status.blockedReason}` : undefined
  ].filter(Boolean).join("\n");
}

export async function routeTelegramCommand(input: TelegramRouteInput): Promise<TelegramRouteResult> {
  const text = input.text.trim();
  if (!text) {
    return {
      kind: "unknown",
      responseText: "Send /help for available artist-runtime commands.",
      shouldStoreFreeText: false
    };
  }

  if (input.workspaceRoot) {
    const personaSessionResponse = await handleTelegramPersonaSessionMessage(input.workspaceRoot, text);
    if (personaSessionResponse) {
      return { kind: "persona", responseText: personaSessionResponse, shouldStoreFreeText: false };
    }
  }

  const [commandRaw, ...args] = text.split(/\s+/);
  const command = commandRaw.toLowerCase();
  if (input.workspaceRoot && !isLegacyWizardEnabled()) {
    if (
      command === "/talk"
      || command === "/commission"
      || command === "/yes"
      || command === "/no"
      || command === "/edit"
      || command === "/one"
      || command === "/confirm"
      || command === "/cancel"
      || (command === "/persona" && !["check", "show", "fields", "edit", "reset", "migrate"].includes(args[0]?.toLowerCase() ?? ""))
      || (command === "/song" && (isConversationalSongCreate(text) || (args.length > 1 && !["update", "add"].includes(args[0]?.toLowerCase() ?? ""))))
      || !command.startsWith("/")
    ) {
      const routed = await routeTelegramConversation({
        text,
        fromUserId: input.fromUserId,
        chatId: input.chatId,
        workspaceRoot: input.workspaceRoot,
        autopilotStatus: input.autopilotStatus,
        aiReviewProvider: input.aiReviewProvider
      });
      return { kind: command === "/song" ? "song" : command === "/persona" ? "persona" : "free_text", ...routed };
    }
    if (command === "/skip" || command === "/back" || command === "/answer") {
      return {
        kind: "free_text",
        responseText: "もうその wizard 用の言葉は使わなくていい。普通に話してくれれば拾う。",
        shouldStoreFreeText: false
      };
    }
  }
  if (command === "/help" || command === "/start") {
    return {
      kind: "help",
      responseText: [
        "Available commands:",
        "/status - show autopilot status",
        "/songs - list recent songs",
        "/song <songId> - show song detail",
        "/song create [hint] - ask the artist to make a song",
        "/commission <brief> - propose a producer commission for autopilot",
        "/regen <songId> - queue a dry-run regeneration note",
        "/review <songId> - run a debug-only mock AI review",
        "/setup - talk with the artist about persona direction",
        "/persona show|fields|check|reset|migrate - inspect or migrate persona files",
        "/observations [YYYY-MM-DD] - show what artist-runtime collected from X",
        "/pause - pause autopilot",
        "/resume - resume autopilot",
        "/help - show this help"
      ].join("\n"),
      shouldStoreFreeText: false
    };
  }

  if (command === "/setup") {
    if (!input.workspaceRoot) {
      return { kind: "setup", responseText: "Persona setup unavailable: workspace root missing.", shouldStoreFreeText: false };
    }
    const routed = await routeTelegramConversation({
      text: args.length > 0 ? `/persona ${args.join(" ")}` : "/persona アーティストの輪郭を一緒に決めたい",
      fromUserId: input.fromUserId,
      chatId: input.chatId,
      workspaceRoot: input.workspaceRoot,
      autopilotStatus: input.autopilotStatus,
      aiReviewProvider: input.aiReviewProvider
    });
    return { kind: "setup", ...routed };
  }

  if (command === "/persona") {
    if (!input.workspaceRoot) {
      return { kind: "persona", responseText: "Persona command unavailable: workspace root missing.", shouldStoreFreeText: false };
    }
    const subcommand = args[0]?.toLowerCase();
    if (subcommand === "fields") {
      return { kind: "persona", responseText: formatPersonaFields(), shouldStoreFreeText: false };
    }
    if (subcommand === "show") {
      return { kind: "persona", responseText: await formatPersonaShow(input.workspaceRoot), shouldStoreFreeText: false };
    }
    if (subcommand === "check") {
      const mode = args[1]?.toLowerCase();
      const report = await auditPersonaCompleteness(input.workspaceRoot);
      if (mode === "fill") {
        return {
          kind: "persona",
          responseText: [
            formatPersonaCheckSummary(report),
            "",
            "Wizard fill has been retired. Tell the artist what you want changed in normal language, then approve the proposed ChangeSet with /yes."
          ].join("\n"),
          shouldStoreFreeText: false
        };
      }
      if (mode === "suggest") {
        return {
          kind: "persona",
          responseText: await formatPersonaSuggestions(report, input.aiReviewProvider, input.workspaceRoot),
          shouldStoreFreeText: false
        };
      }
      return { kind: "persona", responseText: formatPersonaCheckReport(report), shouldStoreFreeText: false };
    }
    if (subcommand === "edit") {
      const routed = await routeTelegramConversation({
        text: `/persona ${args.slice(1).join(" ") || "personaを自然な会話で直したい"}`,
        fromUserId: input.fromUserId,
        chatId: input.chatId,
        workspaceRoot: input.workspaceRoot,
        autopilotStatus: input.autopilotStatus,
        aiReviewProvider: input.aiReviewProvider
      });
      return { kind: "persona", ...routed };
    }
    if (subcommand === "reset") {
      await createTelegramPersonaSession(input.workspaceRoot, {
        mode: "reset_confirm",
        chatId: input.chatId,
        userId: input.fromUserId
      });
      return {
        kind: "persona",
        responseText: "This will replace Telegram-managed ARTIST/SOUL persona blocks. Reply /confirm reset or /cancel.",
        shouldStoreFreeText: false
      };
    }
    if (subcommand === "migrate") {
      const migrateMatch = text.match(/^\/persona\s+migrate(?:\s+([\s\S]*))?$/i);
      const intent = migrateMatch?.[1]?.trim() || undefined;
      const plan = await planPersonaMigrate(input.workspaceRoot, { intent, aiReviewProvider: input.aiReviewProvider });
      await createTelegramPersonaSession(input.workspaceRoot, {
        mode: "migrate_confirm",
        chatId: input.chatId,
        userId: input.fromUserId,
        migrateIntent: intent,
        migrateAiReviewProvider: input.aiReviewProvider
      });
      return {
        kind: "persona",
        responseText: formatPersonaMigratePlan(plan),
        shouldStoreFreeText: false
      };
    }
    return {
      kind: "persona",
      responseText: "Usage: /persona show | /persona fields | /persona check [suggest] | /persona reset | /persona migrate",
      shouldStoreFreeText: false
    };
  }

  if (command === "/status") {
    return {
      kind: "status",
      responseText: formatStatus(input.autopilotStatus),
      shouldStoreFreeText: false
    };
  }

  if (command === "/songs") {
    if (!input.workspaceRoot) {
      return { kind: "songs", responseText: "Song list unavailable: workspace root missing.", shouldStoreFreeText: false };
    }
    const songs = await listRecentSongs(input.workspaceRoot, 10);
    return {
      kind: "songs",
      responseText: songs.length === 0
        ? "No songs yet."
        : songs.map((song) => `${song.songId} | ${song.status} | ${song.title}`).join("\n"),
      shouldStoreFreeText: false
    };
  }

  if (command === "/song") {
    const subcommand = args[0]?.toLowerCase();
    if (subcommand === "update") {
      if (!input.workspaceRoot || !args[1]) {
        return { kind: "song", responseText: "Usage: /song update <songId>", shouldStoreFreeText: false };
      }
      const routed = await routeTelegramConversation({
        text: `/song ${args[1]} ${args.slice(2).join(" ") || "この曲を更新したい"}`,
        fromUserId: input.fromUserId,
        chatId: input.chatId,
        workspaceRoot: input.workspaceRoot,
        autopilotStatus: input.autopilotStatus,
        aiReviewProvider: input.aiReviewProvider
      });
      return { kind: "song", ...routed };
    }
    if (subcommand === "add") {
      if (!input.workspaceRoot) {
        return { kind: "song", responseText: "Song add unavailable: workspace root missing.", shouldStoreFreeText: false };
      }
      const routed = await routeTelegramConversation({
        text: `/song create ${args.slice(1).join(" ")}`.trim(),
        fromUserId: input.fromUserId,
        chatId: input.chatId,
        workspaceRoot: input.workspaceRoot,
        autopilotStatus: input.autopilotStatus,
        aiReviewProvider: input.aiReviewProvider
      });
      return { kind: "song", ...routed };
    }
    if (subcommand === "create") {
      if (!input.workspaceRoot) {
        return { kind: "song", responseText: "Song create unavailable: workspace root missing.", shouldStoreFreeText: false };
      }
      const routed = await routeTelegramConversation({
        text,
        fromUserId: input.fromUserId,
        chatId: input.chatId,
        workspaceRoot: input.workspaceRoot,
        autopilotStatus: input.autopilotStatus,
        aiReviewProvider: input.aiReviewProvider
      });
      return { kind: "song", ...routed };
    }
    const songId = args[0];
    if (!input.workspaceRoot || !songId) {
      return { kind: "song", responseText: "Usage: /song <songId> | /song update <songId> | /song add", shouldStoreFreeText: false };
    }
    const song = await getSongDetail(input.workspaceRoot, songId);
    return {
      kind: "song",
      responseText: [
        `${song.songId} | ${song.status} | ${song.title}`,
        song.selectedTakeId ? `Selected take: ${song.selectedTakeId}` : undefined,
        `Imported assets: ${song.importedPaths.length}`,
        song.brief ? `Brief: ${song.brief.slice(0, 240)}` : undefined
      ].filter(Boolean).join("\n"),
      shouldStoreFreeText: false
    };
  }

  if (command === "/observations") {
    if (!input.workspaceRoot) {
      return { kind: "observations", responseText: "Observations unavailable: workspace root missing.", shouldStoreFreeText: false };
    }
    const dateArg = args[0]?.trim();
    const report = await readObservationsReport(input.workspaceRoot, dateArg || new Date());
    return { kind: "observations", responseText: formatObservationsReport(report), shouldStoreFreeText: false };
  }

  if (command === "/regen") {
    const songId = args[0];
    if (!input.workspaceRoot || !songId) {
      return { kind: "regen", responseText: "Usage: /regen <songId>", shouldStoreFreeText: false };
    }
    await storeTelegramInbox(input.workspaceRoot, {
      type: "regen_requested",
      songId,
      fromUserId: input.fromUserId,
      chatId: input.chatId,
      text,
      timestamp: Date.now()
    });
    return {
      kind: "regen",
      responseText: `Queued dry-run regeneration request for ${songId}. No Suno create was started.`,
      shouldStoreFreeText: false
    };
  }

  if (command === "/review") {
    const songId = args[0];
    if (!input.workspaceRoot || !songId) {
      return { kind: "review", responseText: "Usage: /review <songId>", shouldStoreFreeText: false };
    }
    try {
      const material = await readSongMaterial(input.workspaceRoot, songId);
      const result = await reviewSongDebugMaterial(input.workspaceRoot, material, input.aiReviewProvider);
      return { kind: "review", responseText: formatDebugAiReviewResult(result), shouldStoreFreeText: false };
    } catch {
      return {
        kind: "review",
        responseText: `Debug review unavailable for ${songId}: song material was not found.`,
        shouldStoreFreeText: false
      };
    }
  }

  if (command === "/pause") {
    if (!input.workspaceRoot) {
      return { kind: "pause", responseText: "Pause unavailable: workspace root missing.", shouldStoreFreeText: false };
    }
    await new AutopilotControlService().pause(input.workspaceRoot, `telegram:${input.fromUserId}`);
    return { kind: "pause", responseText: "Autopilot paused.", shouldStoreFreeText: false };
  }

  if (command === "/resume") {
    if (!input.workspaceRoot) {
      return { kind: "resume", responseText: "Resume unavailable: workspace root missing.", shouldStoreFreeText: false };
    }
    await new AutopilotControlService().resume(input.workspaceRoot, { reason: `telegram:${input.fromUserId}`, source: "telegram" });
    return { kind: "resume", responseText: "Autopilot resumed.", shouldStoreFreeText: false };
  }

  if (command.startsWith("/")) {
    return {
      kind: "unknown",
      responseText: `Unknown command: ${command}. Send /help for available commands.`,
      shouldStoreFreeText: false
    };
  }

  return {
    kind: "free_text",
    responseText: "Instruction received for local artist inbox staging.",
    shouldStoreFreeText: true
  };
}

function needsPersonaFill(field: PersonaFieldAudit): boolean {
  return field.status === "missing" || field.status === "thin";
}

function formatPersonaCheckSummary(report: Awaited<ReturnType<typeof auditPersonaCompleteness>>): string {
  const needs = report.fields.filter(needsPersonaFill).map((field) => field.field);
  return [
    `Persona check: ${report.summary.filled} filled, ${report.summary.thin} thin, ${report.summary.missing} missing.`,
    needs.length > 0 ? `Needs: ${needs.join(", ")}` : "All fields filled.",
    report.customSections.length > 0 ? `Custom sections: ${report.customSections.join(", ")}` : undefined
  ].filter(Boolean).join("\n");
}

function formatPersonaCheckReport(report: Awaited<ReturnType<typeof auditPersonaCompleteness>>): string {
  const full = formatPersonaAuditReport(report);
  if (full.length <= 1500) {
    return full;
  }
  return formatPersonaCheckSummary(report);
}

async function formatPersonaSuggestions(
  report: Awaited<ReturnType<typeof auditPersonaCompleteness>>,
  provider?: AiReviewProvider,
  root?: string
): Promise<string> {
  const fields = report.fields.filter(needsPersonaFill).map((field) => field.field);
  if (fields.length === 0) {
    return "Persona suggestion mode: all fields are filled.";
  }
  const [artistMd, soulMd] = root
    ? await Promise.all([
        readFile(join(root, "ARTIST.md"), "utf8").catch(() => ""),
        readFile(join(root, "SOUL.md"), "utf8").catch(() => "")
      ])
    : ["", ""];
  const result = await proposePersonaFields({
    fields,
    source: {
      artistMd,
      soulMd,
      customSections: report.customSections
    }
  }, { aiReviewProvider: provider });
  return [
    "Persona suggestion mode:",
    `Provider: ${result.provider}`,
    ...result.drafts.map((draft) =>
      draft.status === "skipped"
        ? `- ${draft.field}: skipped${draft.reasoning ? ` (${draft.reasoning})` : ""}`
        : `- ${draft.field}: ${draft.draft}${draft.reasoning ? ` (${draft.reasoning})` : ""}`
    ),
    result.provider === "mock" ? "Mock provider placeholder drafts only." : undefined,
    result.provider === "not_configured" ? "Configure AI provider for suggestions (currently mock)." : undefined,
    result.warnings.length > 0 ? `Warnings: ${result.warnings.join("; ")}` : undefined
  ].filter(Boolean).join("\n");
}

function formatPersonaFields(): string {
  return [
    "Editable persona fields:",
    "ARTIST: name, identity, sound, themes, lyrics, social",
    "SOUL: soul-tone, soul-refusal"
  ].join("\n");
}

async function formatPersonaShow(root: string): Promise<string> {
  const [artist, soul] = await Promise.all([readArtistPersonaSummary(root), readSoulPersonaSummary(root)]);
  const response = [
    `Artist: ${artist.artistName}`,
    `Identity: ${artist.identityLine}`,
    `Sound: ${artist.soundDna}`,
    `Themes: ${artist.obsessions}`,
    `Lyrics guard: ${artist.lyricsRules}`,
    `Social voice: ${artist.socialVoice}`,
    "---",
    `Conversation tone: ${soul.conversationTone || "(not set)"}`,
    `Refusal style: ${soul.refusalStyle || "(not set)"}`
  ].join("\n");
  return response.length > 1600 ? `${response.slice(0, 1597)}...` : response;
}

function truncateInline(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

export function formatObservationsReport(report: ObservationReport): string {
  const header = `🌐 X 観察 ${report.date}`;
  if (!report.exists || report.entries.length === 0) {
    return [
      header,
      report.exists ? "(エントリなし)" : "(まだ収集されてない)",
      `Source: ${report.path}`
    ].join("\n");
  }
  const top = report.entries
    .filter((entry) => {
      const text = entry.text?.trim() ?? "";
      if (!text) return false;
      if (/^date:\s+/i.test(text)) return false;
      return true;
    })
    .slice(0, 10);
  const lines = [
    header,
    report.query ? `Query: ${report.query}` : "Source: timeline",
    `Total: ${report.entries.length} entries (showing ${top.length})`,
    ""
  ];
  top.forEach((entry, index) => {
    const author = entry.author ? `@${entry.author}` : "(anonymous)";
    const text = truncateInline(entry.text, 180);
    lines.push(`${index + 1}. ${author}`);
    lines.push(`   ${text}`);
    if (entry.url) {
      lines.push(`   ${entry.url}`);
    }
  });
  lines.push("");
  lines.push(`Source: ${report.path}`);
  const joined = lines.join("\n");
  return joined.length > 3500 ? `${joined.slice(0, 3497)}...` : joined;
}

export function classifyTelegramFreeText(text: string): "pause" | "resume" | "status" | "artist_inbox" {
  const normalized = text.toLowerCase();
  if (normalized.includes("pause")) {
    return "pause";
  }
  if (normalized.includes("resume")) {
    return "resume";
  }
  if (normalized.includes("status")) {
    return "status";
  }
  return "artist_inbox";
}

export async function storeTelegramInbox(root: string, value: Record<string, unknown>): Promise<void> {
  const path = inboxPath(root);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

export async function readTelegramInbox(root: string): Promise<Record<string, unknown>[]> {
  const contents = await readFile(inboxPath(root), "utf8").catch(() => "");
  return contents
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
