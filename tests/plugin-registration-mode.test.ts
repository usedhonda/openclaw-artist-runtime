import { describe, expect, it } from "vitest";
import registerArtistRuntime from "../src/index";

interface FakeApiCalls {
  tools: string[];
  hooks: string[];
  services: string[];
  routes: string[];
  commands: string[];
  interactiveHandlers: string[];
}

function makeFakeApi(registrationMode: string | undefined, calls: FakeApiCalls) {
  return {
    ...(registrationMode !== undefined ? { registrationMode } : {}),
    registerTool(definitionOrFactory: { name: string } | ((context: { workspaceDir: string }) => { name: string })) {
      const definition = typeof definitionOrFactory === "function"
        ? definitionOrFactory({ workspaceDir: "/trusted/artist-workspace" })
        : definitionOrFactory;
      calls.tools.push(definition.name);
    },
    registerHook(events: string | string[]) {
      const names = Array.isArray(events) ? events : [events];
      calls.hooks.push(...names);
    },
    on(event: string) {
      // Typed hooks (before_prompt_build, agent_turn_prepare) register here.
      calls.hooks.push(event);
    },
    registerService(definition: { id?: string; name?: string }) {
      calls.services.push(definition.id ?? definition.name ?? "unknown");
    },
    registerHttpRoute(definition: { path: string }) {
      calls.routes.push(definition.path);
    },
    registerCommand(command: { name: string }) {
      calls.commands.push(command.name);
    },
    registerInteractiveHandler(registration: { channel: string; namespace: string }) {
      calls.interactiveHandlers.push(`${registration.channel}:${registration.namespace}`);
    },
    getPluginCommandSpecs() {
      return [];
    }
  };
}

describe("plugin entry registrationMode gating", () => {
  it("installs no process-wide crash listeners outside full mode", () => {
    const calls: FakeApiCalls = { tools: [], hooks: [], services: [], routes: [], commands: [], interactiveHandlers: [] };
    const before = process.listenerCount("unhandledRejection");

    registerArtistRuntime.register(makeFakeApi("discovery", calls));

    expect(process.listenerCount("unhandledRejection")).toBe(before);
  });

  it("registers only tools and hooks in discovery mode — no services, routes, commands, or interactive handler", () => {
    const calls: FakeApiCalls = { tools: [], hooks: [], services: [], routes: [], commands: [], interactiveHandlers: [] };
    registerArtistRuntime.register(makeFakeApi("discovery", calls));

    expect(calls.tools.length).toBeGreaterThan(0);
    expect(calls.hooks.length).toBeGreaterThan(0);
    expect(calls.services).toEqual([]);
    expect(calls.routes).toEqual([]);
    expect(calls.commands).toEqual([]);
    expect(calls.interactiveHandlers).toEqual([]);
  });

  it("registers only tools and hooks in tool-discovery mode", () => {
    const calls: FakeApiCalls = { tools: [], hooks: [], services: [], routes: [], commands: [], interactiveHandlers: [] };
    registerArtistRuntime.register(makeFakeApi("tool-discovery", calls));

    expect(calls.tools.length).toBeGreaterThan(0);
    expect(calls.services).toEqual([]);
    expect(calls.routes).toEqual([]);
    expect(calls.commands).toEqual([]);
    expect(calls.interactiveHandlers).toEqual([]);
  });

  it("registers only tools and hooks in cli-metadata and setup-only modes", () => {
    for (const mode of ["cli-metadata", "setup-only"]) {
      const calls: FakeApiCalls = { tools: [], hooks: [], services: [], routes: [], commands: [], interactiveHandlers: [] };
      registerArtistRuntime.register(makeFakeApi(mode, calls));
      expect(calls.services).toEqual([]);
      expect(calls.routes).toEqual([]);
      expect(calls.commands).toEqual([]);
      expect(calls.interactiveHandlers).toEqual([]);
    }
  });

  it("registers everything — tools, hooks, services, routes, commands, interactive handler — in full mode", () => {
    const calls: FakeApiCalls = { tools: [], hooks: [], services: [], routes: [], commands: [], interactiveHandlers: [] };
    registerArtistRuntime.register(makeFakeApi("full", calls));

    expect(calls.tools.length).toBeGreaterThan(0);
    expect(calls.hooks.length).toBeGreaterThan(0);
    expect(calls.services.length).toBeGreaterThan(0);
    expect(calls.routes.length).toBeGreaterThan(0);
    expect(calls.commands.length).toBeGreaterThan(0);
    expect(calls.interactiveHandlers).toEqual(["telegram:cb"]);
  });
});
