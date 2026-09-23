import { describe, expect, it } from "vitest";
import { registerHooks } from "../src/hooks/index.js";

// The OpenClaw host's recognized PluginHookName union (installed host: OpenClaw
// 2026.9.5, dist/hook-runner-global-*.d.ts PluginHookHandlerMap / hook-types region).
// Typed PluginHookName hooks (before_prompt_build, agent_turn_prepare, ...) register
// through api.on. api.registerHook is a separate, untyped internal type:action event
// bus (InternalHookEvent.type in "command" | "session" | "agent" | "gateway" |
// "message") that does not validate names against this list either — a name that
// matches neither a valid "type" nor a real "type:action" combo registers
// successfully but never fires. "agent:bootstrap" (the old name this plugin used) was
// neither. This list guards api.registerHook registrations against regressing to an
// unrecognized PluginHookName-shaped string again.
const KNOWN_PLUGIN_HOOK_NAMES = [
  "before_model_resolve", "agent_turn_prepare", "before_prompt_build", "before_agent_reply",
  "model_call_started", "model_call_ended", "llm_input", "llm_output", "before_agent_finalize",
  "agent_end", "before_compaction", "after_compaction", "before_reset", "inbound_claim",
  "channel_pairing_requested", "message_received", "message_sending", "reply_payload_sending",
  "message_sent", "before_tool_call", "after_tool_call", "tool_result_persist",
  "before_message_write", "session_start", "session_end", "subagent_delivery_target",
  "subagent_spawned", "subagent_progress", "subagent_ended", "gateway_start", "gateway_stop",
  "heartbeat_prompt_contribution", "cron_reconciled", "cron_changed", "skill_proposal_evaluate",
  "skill_proposal_changed", "skill_changed", "before_dispatch", "reply_dispatch", "before_install",
  "before_agent_run", "resolve_exec_env"
];

describe("registerHooks — lifecycle skeleton", () => {
  it("registers nothing on the legacy registerHook bus, which 2026.9 never invokes for these events", () => {
    const registered: string[] = [];
    const api = {
      registerHook: (events: string | string[]) => {
        const names = Array.isArray(events) ? events : [events];
        registered.push(...names);
      }
    };

    registerHooks(api);

    expect(registered).toEqual([]);
  });

  it("registers every registerHook event name as a recognized OpenClaw PluginHookName", () => {
    const registered: string[] = [];
    const api = {
      registerHook: (events: string | string[]) => {
        const names = Array.isArray(events) ? events : [events];
        registered.push(...names);
      }
    };

    registerHooks(api);

    for (const name of registered) {
      expect(KNOWN_PLUGIN_HOOK_NAMES).toContain(name);
    }
  });

  it("registers agent_turn_prepare through api.on (the typed PluginHookName path), not registerHook", () => {
    const onEvents: string[] = [];
    const api = {
      on: (event: string) => {
        onEvents.push(event);
      },
      registerHook: () => undefined
    };

    registerHooks(api);

    expect(onEvents).toContain("agent_turn_prepare");
    expect(onEvents).toContain("before_prompt_build");
    for (const name of onEvents) {
      expect(KNOWN_PLUGIN_HOOK_NAMES).toContain(name);
    }
  });

  it("is a no-op when api does not implement registerHook or on", () => {
    expect(() => registerHooks({})).not.toThrow();
  });

  it("agent_turn_prepare handler returns a prependContext string when the injection is enabled", async () => {
    const onHandlers = new Map<string, (event: unknown, context: { workspaceDir?: string }) => unknown | Promise<unknown>>();
    const api = {
      on: (event: string, handler: (event: unknown, context: { workspaceDir?: string }) => unknown | Promise<unknown>) => {
        onHandlers.set(event, handler);
      },
      registerHook: () => undefined
    };
    const previous = process.env.OPENCLAW_ARTIST_TURN_CONTEXT;
    process.env.OPENCLAW_ARTIST_TURN_CONTEXT = "on";

    try {
      registerHooks(api);

      const handler = onHandlers.get("agent_turn_prepare");
      expect(handler).toBeDefined();

      const result = await handler?.({}, { workspaceDir: "." }) as { prependContext?: unknown };
      expect(typeof result.prependContext).toBe("string");
    } finally {
      if (previous === undefined) delete process.env.OPENCLAW_ARTIST_TURN_CONTEXT;
      else process.env.OPENCLAW_ARTIST_TURN_CONTEXT = previous;
    }
  });

  it("injects nothing per turn unless OPENCLAW_ARTIST_TURN_CONTEXT opts in", async () => {
    const onHandlers = new Map<string, (event: unknown, context: { workspaceDir?: string }) => unknown | Promise<unknown>>();
    const api = {
      on: (event: string, handler: (event: unknown, context: { workspaceDir?: string }) => unknown | Promise<unknown>) => {
        onHandlers.set(event, handler);
      },
      registerHook: () => undefined
    };
    const previous = process.env.OPENCLAW_ARTIST_TURN_CONTEXT;
    delete process.env.OPENCLAW_ARTIST_TURN_CONTEXT;

    try {
      registerHooks(api);

      const handler = onHandlers.get("agent_turn_prepare");
      expect(handler).toBeDefined();
      expect(await handler?.({}, { workspaceDir: "." })).toBeUndefined();
    } finally {
      if (previous !== undefined) process.env.OPENCLAW_ARTIST_TURN_CONTEXT = previous;
    }
  });

  it("agent_turn_prepare handler returns undefined when no workspaceDir is present in context", async () => {
    const onHandlers = new Map<string, (event: unknown, context: { workspaceDir?: string }) => unknown | Promise<unknown>>();
    const api = {
      on: (event: string, handler: (event: unknown, context: { workspaceDir?: string }) => unknown | Promise<unknown>) => {
        onHandlers.set(event, handler);
      },
      registerHook: () => undefined
    };

    registerHooks(api);

    const handler = onHandlers.get("agent_turn_prepare");
    expect(await handler?.({}, {})).toBeUndefined();
  });
});
