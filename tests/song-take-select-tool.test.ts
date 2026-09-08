import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { selectTake, updateProductionConversation } = vi.hoisted(() => ({ selectTake: vi.fn(), updateProductionConversation: vi.fn() }));
vi.mock("../src/services/takeSelection", () => ({ selectTake }));
vi.mock("../src/services/productionConversation", () => ({ updateProductionConversation }));

import { registerSongTools } from "../src/tools/songTools";

describe("artist_take_select tool contract", () => {
  beforeEach(() => {
    vi.stubEnv("TELEGRAM_OWNER_USER_IDS", "1");
    selectTake.mockReset();
    updateProductionConversation.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("requires exact adoption fields and records the durable adopted conversation", async () => {
    selectTake.mockResolvedValue({ songId: "song-001", runId: "run-old", selectedTakeId: "take-a", sourceUrls: [] });
    updateProductionConversation.mockResolvedValue({ phase: "adopted" });
    let definition: { parameters?: Record<string, unknown>; execute: (id: string, input: unknown) => Promise<unknown> } | undefined;
    registerSongTools({
      registerTool(factory: (context: unknown) => typeof definition) {
        definition = factory({ workspaceDir: "/workspace", requesterSenderId: "1", senderIsOwner: false, sessionKey: "session", messageChannel: "telegram", deliveryContext: { channel: "telegram", to: "1" } }) as typeof definition;
      }
    });
    const parameters = definition?.parameters as { required?: string[]; properties?: Record<string, { default?: unknown }> };
    expect(parameters.required).toEqual(["songId", "runId", "selectedTakeId", "reason"]);
    expect(parameters.properties?.conversational?.default).toBe(true);
    await definition!.execute("call-1", { songId: "song-001", runId: "run-old", selectedTakeId: "take-a", reason: "producer chose earlier vocal" });
    expect(selectTake).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-old", selectedTakeId: "take-a", conversational: true, producerDecision: true }));
    expect(updateProductionConversation).toHaveBeenCalledWith("/workspace", expect.objectContaining({ requesterSenderId: "1", senderIsOwner: false }), expect.objectContaining({ songId: "song-001", runId: "run-old", phase: "adopted", pendingDecision: "", acceptedTake: { runId: "run-old", takeId: "take-a" } }));
  });

  it("rejects a non-owner before selecting or updating conversation", async () => {
    let definition: { execute: (id: string, input: unknown) => Promise<unknown> } | undefined;
    registerSongTools({
      registerTool(factory: (context: unknown) => unknown) {
        definition = factory({ workspaceDir: "/workspace", senderIsOwner: false }) as typeof definition;
      }
    });
    await expect(definition!.execute("call-2", { songId: "song-001", runId: "run-old", selectedTakeId: "take-a", reason: "no" })).rejects.toThrow("producer-only");
    expect(selectTake).not.toHaveBeenCalled();
    expect(updateProductionConversation).not.toHaveBeenCalled();
  });

  it("keeps a successful non-Telegram selection when no conversation context exists", async () => {
    selectTake.mockResolvedValue({ songId: "song-001", runId: "run-old", selectedTakeId: "take-a", sourceUrls: [] });
    updateProductionConversation.mockResolvedValue(undefined);
    let definition: { execute: (id: string, input: unknown) => Promise<unknown> } | undefined;
    registerSongTools({
      registerTool(factory: (context: unknown) => unknown) {
        definition = factory({ workspaceDir: "/workspace", senderIsOwner: true, messageChannel: "cli" }) as typeof definition;
      }
    });
    await expect(definition!.execute("call-3", { songId: "song-001", runId: "run-old", selectedTakeId: "take-a", reason: "local producer choice" })).resolves.toMatchObject({ details: { runId: "run-old", selectedTakeId: "take-a" } });
  });
});
