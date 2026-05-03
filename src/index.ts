// Plugin entry for OpenClaw 2026.5.x SDK contract (definePluginEntry-shape).
// Local shim mirrors openclaw/plugin-sdk's definePluginEntry passthrough so the
// distributed tarball doesn't import openclaw at module-eval time (peer dep).
import { registerTools } from "./tools/index.js";
import { registerHooks } from "./hooks/index.js";
import { registerServices } from "./services/index.js";
import { registerRoutes } from "./routes/index.js";
import { registerCommands } from "./commands/index.js";

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
    registerTools(api);
    registerHooks(api);
    registerServices(api);
    registerRoutes(api);
    registerCommands(api);
    logTelegramCommandSpecs(api);
  }
});
