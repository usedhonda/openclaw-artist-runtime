import { safeRegisterAgentTurnPrepareHook, safeRegisterProductionPromptHook } from "../pluginApi.js";
import { bootstrapArtistContext } from "./bootstrapArtist.js";
import { productionPromptContext } from "../services/productionConversation.js";

function artistTurnContextEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.OPENCLAW_ARTIST_TURN_CONTEXT?.trim().toLowerCase();
  return raw === "on" || raw === "1" || raw === "true";
}

export function registerHooks(api: unknown): void {
  safeRegisterProductionPromptHook(api, async (_event, context) => {
    if (!context.sessionKey || !context.workspaceDir) return undefined;
    const prependContext = await productionPromptContext(context.workspaceDir, context.sessionKey);
    return prependContext ? { prependContext } : undefined;
  });

  // "agent:bootstrap" is not a recognized OpenClaw hook name (see the PluginHookName
  // union in the installed host's dist/hook-runner-global-*.d.ts), so this handler
  // never fired. "agent_turn_prepare" is a real PluginHookName that fires before
  // every agent turn is prepared, and its result shape (PluginAgentTurnPrepareResult:
  // { prependContext?, appendContext? }) is exactly what bootstrapArtistContext's
  // workspace-context text is for.
  //
  // Typed PluginHookName hooks register through `api.on`, not `api.registerHook`:
  // `registerHook` is a separate, untyped internal type:action event bus
  // (InternalHookEvent.type in "command" | "session" | "agent" | "gateway" |
  // "message", matched by exact type or "type:action"), and "agent_turn_prepare" has
  // no colon and matches nothing on it. Evidence this fires: the already-live
  // `safeRegisterProductionPromptHook` above registers "before_prompt_build" — also a
  // PluginHookName — through this exact same `api.on` path.
  //
  // The injection itself is opt-in. This handler never fired before, so every
  // deployment has been running without it; switching it on silently would add
  // the four persona files (tens of kilobytes here) to the context of every
  // agent turn, at a real per-turn cost and possibly duplicating the host's own
  // workspace-file loading. OPENCLAW_ARTIST_TURN_CONTEXT=on opts in.
  safeRegisterAgentTurnPrepareHook(api, async (_event, context) => {
    if (!artistTurnContextEnabled() || !context.workspaceDir) return undefined;
    const prependContext = await bootstrapArtistContext(context.workspaceDir);
    return prependContext ? { prependContext } : undefined;
  });

  // before_tool_call / after_tool_call / gateway_start / gateway_stop used to be
  // registered here through api.registerHook as placeholders that only returned a
  // status object. The 2026.9 host reports that these events are "dispatched by the
  // typed hook runner only; api.registerHook registrations for it are not invoked",
  // so they never ran, and moving the placeholders to api.on would have given the
  // typed runner handlers whose return values mean nothing to it. They are dropped.
}
