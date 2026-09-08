import type { ArtistToolContext } from "../pluginApi.js";
import { safeRegisterTool } from "../pluginApi.js";
import { createSongIdea } from "../services/songIdeation.js";
import { selectTake } from "../services/takeSelection.js";
import { updateProductionConversation } from "../services/productionConversation.js";

export function registerSongTools(api: unknown): void {
  safeRegisterTool(api, {
    name: "artist_song_ideate",
    description: "Create and persist an Artist Runtime song idea in the active artist workspace.",
    handler: async (input) => {
      const payload = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
      return createSongIdea({
        workspaceRoot: typeof payload.workspaceRoot === "string" ? payload.workspaceRoot : ".",
        title: typeof payload.title === "string" ? payload.title : undefined,
        artistReason: typeof payload.artistReason === "string" ? payload.artistReason : undefined,
        config: typeof payload.config === "object" && payload.config !== null ? (payload.config as Record<string, unknown>) : undefined
      });
    }
  });

  safeRegisterTool(api, {
    name: "artist_take_select",
    description: "Select a generated Suno take for an Artist Runtime song in the active artist workspace.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["songId", "runId", "selectedTakeId", "reason"],
      properties: {
        songId: { type: "string", minLength: 1 },
        runId: { type: "string", minLength: 1 },
        selectedTakeId: { type: "string", minLength: 1 },
        reason: { type: "string", minLength: 1 },
        conversational: { type: "boolean", default: true }
      }
    },
    handler: async (input, context?: ArtistToolContext) => {
      const payload = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
      if (context?.senderIsOwner === false) throw new Error("producer-only take selection");
      if (typeof payload.songId !== "string" || typeof payload.runId !== "string" || typeof payload.selectedTakeId !== "string" || typeof payload.reason !== "string" || !payload.songId || !payload.runId || !payload.selectedTakeId || !payload.reason) {
        throw new Error("songId, runId, selectedTakeId, and reason are required");
      }
      const workspaceRoot = typeof payload.workspaceRoot === "string" ? payload.workspaceRoot : ".";
      const selection = await selectTake({
        workspaceRoot,
        songId: payload.songId,
        runId: payload.runId,
        selectedTakeId: payload.selectedTakeId,
        reason: payload.reason,
        conversational: payload.conversational !== false,
        producerDecision: true
      });
      await updateProductionConversation(workspaceRoot, context, {
        songId: selection.songId,
        runId: selection.runId,
        acceptedTake: { runId: selection.runId, takeId: selection.selectedTakeId },
        phase: "adopted",
        pendingDecision: ""
      });
      return selection;
    }
  });
}
