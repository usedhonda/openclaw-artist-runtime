import { safeRegisterTool } from "../pluginApi.js";
import { createSongIdea } from "../services/songIdeation.js";
import { selectTake } from "../services/takeSelection.js";

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
    handler: async (input) => {
      const payload = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
      return selectTake({
        workspaceRoot: typeof payload.workspaceRoot === "string" ? payload.workspaceRoot : ".",
        songId: typeof payload.songId === "string" ? payload.songId : "song-001",
        runId: typeof payload.runId === "string" ? payload.runId : undefined,
        selectedTakeId: typeof payload.selectedTakeId === "string" ? payload.selectedTakeId : undefined,
        reason: typeof payload.reason === "string" ? payload.reason : undefined
      });
    }
  });
}
