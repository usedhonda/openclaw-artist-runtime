import type { ArtistRuntimeConfig } from "../types.js";
import { safeRegisterCommand } from "../pluginApi.js";
import { ArtistAutopilotService } from "../services/autopilotService.js";
import { resolveRuntimeConfig } from "../services/runtimeConfig.js";
import { routeTelegramCommand } from "../services/telegramCommandRouter.js";

interface PluginCommandContextLike {
  senderId?: string;
  channel?: string;
  args?: string;
  commandBody?: string;
  config?: unknown;
  from?: string;
  to?: string;
  messageThreadId?: string | number;
}

interface PluginApiWithConfig {
  config?: unknown;
  pluginConfig?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractPluginConfig(value: unknown): Partial<ArtistRuntimeConfig> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if ("artist" in value || "autopilot" in value || "telegram" in value || "aiReview" in value) {
    return value as Partial<ArtistRuntimeConfig>;
  }
  const entries = isRecord(value.plugins) && isRecord(value.plugins.entries) ? value.plugins.entries : undefined;
  const entry = entries && isRecord(entries["artist-runtime"]) ? entries["artist-runtime"] : undefined;
  const config = entry && isRecord(entry.config) ? entry.config : undefined;
  return config as Partial<ArtistRuntimeConfig> | undefined;
}

function readNumericId(...values: Array<string | number | undefined>): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value !== "string") {
      continue;
    }
    const match = value.match(/-?\d+/);
    if (!match) {
      continue;
    }
    const numeric = Number.parseInt(match[0], 10);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return 0;
}

function commandText(name: string, ctx: PluginCommandContextLike): string {
  const body = ctx.commandBody?.trim();
  if (body?.startsWith("/")) {
    return body;
  }
  const args = ctx.args?.trim();
  return args ? `/${name} ${args}` : `/${name}`;
}

async function resolveCommandRuntimeConfig(
  ctx: PluginCommandContextLike,
  api: PluginApiWithConfig
): Promise<ArtistRuntimeConfig> {
  const payloadConfig = extractPluginConfig(ctx.config) ?? extractPluginConfig(api.pluginConfig) ?? extractPluginConfig(api.config);
  const fallbackRoot = payloadConfig?.artist?.workspaceRoot;
  return resolveRuntimeConfig(payloadConfig, fallbackRoot);
}

async function handleRoutedCommand(name: string, ctx: PluginCommandContextLike, api: PluginApiWithConfig): Promise<{ text: string }> {
  const config = await resolveCommandRuntimeConfig(ctx, api);
  const status = await new ArtistAutopilotService().status(config.autopilot.enabled, config.autopilot.dryRun, config.artist.workspaceRoot);
  const result = await routeTelegramCommand({
    text: commandText(name, ctx),
    fromUserId: readNumericId(ctx.senderId),
    chatId: readNumericId(ctx.to, ctx.from, ctx.messageThreadId),
    workspaceRoot: config.artist.workspaceRoot,
    autopilotStatus: status,
    aiReviewProvider: config.aiReview.provider
  });
  return { text: result.responseText };
}

function logRegistration(ok: boolean, name: string): void {
  if (ok) {
    console.info(`[artist-runtime] registered runtime-slash command: ${name}`);
    return;
  }
  console.warn(`[artist-runtime] registerCommand unavailable for: ${name}`);
}

export function registerCommands(api: unknown): void {
  const apiConfig = isRecord(api) ? (api as PluginApiWithConfig) : {};
  safeRegisterCommand(api, {
    name: "persona",
    description: "Persona setup, audit, fill, migrate, edit, reset.",
    acceptsArgs: true,
    requireAuth: true,
    nativeProgressMessages: { telegram: "Checking artist persona..." },
    handler: (ctx) => handleRoutedCommand("persona", ctx as PluginCommandContextLike, apiConfig)
  }, logRegistration);
  safeRegisterCommand(api, {
    name: "song",
    description: "Show or update song records.",
    acceptsArgs: true,
    requireAuth: true,
    nativeProgressMessages: { telegram: "Checking artist song..." },
    handler: (ctx) => handleRoutedCommand("song", ctx as PluginCommandContextLike, apiConfig)
  }, logRegistration);
  safeRegisterCommand(api, {
    name: "commission",
    description: "Propose a song commission.",
    acceptsArgs: true,
    requireAuth: true,
    handler: (ctx) => handleRoutedCommand("commission", ctx as PluginCommandContextLike, apiConfig)
  }, logRegistration);
  safeRegisterCommand(api, {
    name: "setup",
    description: "Start persona setup.",
    acceptsArgs: true,
    requireAuth: true,
    handler: (ctx) => handleRoutedCommand("setup", ctx as PluginCommandContextLike, apiConfig)
  }, logRegistration);
  safeRegisterCommand(api, {
    name: "observations",
    description: "Show collected X observations.",
    acceptsArgs: true,
    requireAuth: true,
    handler: (ctx) => handleRoutedCommand("observations", ctx as PluginCommandContextLike, apiConfig)
  }, logRegistration);
  safeRegisterCommand(api, {
    name: "resume",
    description: "Resume autopilot or recovery.",
    acceptsArgs: true,
    requireAuth: true,
    handler: (ctx) => handleRoutedCommand("resume", ctx as PluginCommandContextLike, apiConfig)
  }, logRegistration);
  for (const name of ["confirm", "cancel"]) {
    safeRegisterCommand(api, {
      name,
      description: `Confirm or cancel an active proposal.`,
      acceptsArgs: true,
      requireAuth: true,
      handler: (ctx) => handleRoutedCommand(name, ctx as PluginCommandContextLike, apiConfig)
    }, logRegistration);
  }
  for (const [name, description] of [
    ["suno", "Decide Suno wait: go, edit, hold."],
    ["lyrics", "Redraft degraded lyrics."],
    ["plan", "Decide planning wait: apply, skip, edit."],
    ["take", "Decide low-score take: accept, regen, skip."],
    ["draft", "Decide draft proposal: make, skip, edit."]
  ] as const) {
    safeRegisterCommand(api, {
      name,
      description,
      acceptsArgs: true,
      requireAuth: true,
      handler: (ctx) => handleRoutedCommand(name, ctx as PluginCommandContextLike, apiConfig)
    }, logRegistration);
  }
  for (const name of ["yes", "no", "edit", "one", "talk"]) {
    safeRegisterCommand(api, {
      name,
      description: `Talk with the artist.`,
      acceptsArgs: true,
      requireAuth: true,
      handler: (ctx) => handleRoutedCommand(name, ctx as PluginCommandContextLike, apiConfig)
    }, logRegistration);
  }
}
