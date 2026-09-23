// Plugin entry for OpenClaw 2026.5.x SDK contract (definePluginEntry-shape).
// Local shim mirrors openclaw/plugin-sdk's definePluginEntry passthrough so the
// distributed tarball doesn't import openclaw at module-eval time (peer dep).
import { registerTools } from "./tools/index.js";
import { registerHooks } from "./hooks/index.js";
import { registerServices } from "./services/index.js";
import { registerRoutes } from "./routes/index.js";
import { registerCommands } from "./commands/index.js";
import { safeRegisterInteractiveHandler } from "./pluginApi.js";
import { installGatewayProcessCrashReporter } from "./services/processCrashReporter.js";
import { handleTelegramInteractiveCallback } from "./services/telegramInteractiveCallbackGuard.js";
import { setOpenClawAiRuntime } from "./services/openClawAiRuntime.js";

interface PluginCommandSpecLike {
  name?: string;
}

interface PluginEntrySpec {
  id: string;
  name: string;
  description: string;
  register: (api: unknown) => void;
}

function definePluginEntry(spec: PluginEntrySpec): PluginEntrySpec {
  return spec;
}

function readRegistrationMode(api: unknown): string | undefined {
  const registrationMode = typeof api === "object" && api !== null && "registrationMode" in api
    ? (api as { registrationMode?: unknown }).registrationMode
    : undefined;
  return typeof registrationMode === "string" ? registrationMode : undefined;
}

function logTelegramCommandSpecs(api: unknown): void {
  const getPluginCommandSpecs = typeof api === "object" && api !== null
    ? (api as { getPluginCommandSpecs?: (provider?: string) => PluginCommandSpecLike[] }).getPluginCommandSpecs
    : undefined;
  if (typeof getPluginCommandSpecs !== "function") {
    return;
  }
  try {
    const specs = getPluginCommandSpecs("telegram");
    const names = specs.map((spec) => spec.name).filter((name): name is string => typeof name === "string" && name.length > 0);
    console.info(`[artist-runtime] telegram plugin command specs: ${names.join(",") || "(none)"} (count=${names.length}, persona=${names.includes("persona")})`);
  } catch (error) {
    console.warn(`[artist-runtime] telegram plugin command specs unavailable: ${String(error)}`);
  }
}

export default definePluginEntry({
  id: "artist-runtime",
  name: "Artist Runtime",
  description: "Runs OpenClaw as a public autonomous AI musician using Suno and social distribution.",
  register(api: unknown): void {
    const runtime = typeof api === "object" && api !== null && "runtime" in api
      ? (api as { runtime?: unknown }).runtime
      : undefined;
    if (runtime && typeof runtime === "object") {
      setOpenClawAiRuntime(runtime as Parameters<typeof setOpenClawAiRuntime>[0]);
    }
    // Tools and hooks are metadata/capability declarations: safe to register in every
    // registrationMode, including "discovery" and "tool-discovery" (docs/plugins/
    // sdk-entrypoints/registration-mode.md). Services, HTTP routes, commands, and the
    // Telegram interactive handler open sockets, start background workers, and read
    // credentials, so they are gated to "full" — the only mode this plugin needs for
    // its runtime side effects (it has no setup-entry/onboarding flow that would need
    // "setup-runtime").
    registerTools(api);
    registerHooks(api);
    if (readRegistrationMode(api) !== "full") {
      return;
    }
    // Process-wide crash listeners are a side effect too: discovery and metadata loads
    // must not install them (the contract lists listeners among the prohibited effects).
    installGatewayProcessCrashReporter();
    registerServices(api);
    registerRoutes(api);
    registerCommands(api);
    safeRegisterInteractiveHandler(api, {
      channel: "telegram",
      namespace: "cb",
      handler: (ctx) => handleTelegramInteractiveCallback(ctx as Parameters<typeof handleTelegramInteractiveCallback>[0])
    });
    logTelegramCommandSpecs(api);
  }
});
