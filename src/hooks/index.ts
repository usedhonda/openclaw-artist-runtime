import { safeRegisterHook, safeRegisterProductionPromptHook } from "../pluginApi.js";
import { bootstrapArtistContext } from "./bootstrapArtist.js";
import { productionPromptContext } from "../services/productionConversation.js";

export function registerHooks(api: unknown): void {
  safeRegisterProductionPromptHook(api, async (_event, context) => {
    if (!context.sessionKey || !context.workspaceDir) return undefined;
    const prependContext = await productionPromptContext(context.workspaceDir, context.sessionKey);
    return prependContext ? { prependContext } : undefined;
  });
  safeRegisterHook(api, {
    event: "agent:bootstrap",
    handler: async (payload) => {
      const workspaceRoot = typeof payload === "object" && payload !== null && "workspaceRoot" in payload ? String((payload as { workspaceRoot: unknown }).workspaceRoot) : ".";
      return bootstrapArtistContext(workspaceRoot);
    }
  });

  safeRegisterHook(api, {
    event: "before_tool_call",
    handler: async () => ({ status: "guarded" })
  });

  safeRegisterHook(api, {
    event: "after_tool_call",
    handler: async () => ({ status: "audited" })
  });

  // P3 anchor: gateway lifecycle hooks. skeleton only — autopilot.runCycle の
  // 周期呼び出しは P3 本実装で乗せる。詳細: docs/log/codex/008-heartbeat-research.md
  safeRegisterHook(api, {
    event: "gateway_start",
    handler: async () => ({ status: "artist-runtime:ready" })
  });

  safeRegisterHook(api, {
    event: "gateway_stop",
    handler: async () => ({ status: "artist-runtime:stopped" })
  });
}
