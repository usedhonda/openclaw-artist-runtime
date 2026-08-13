import { safeRegisterTool } from "../pluginApi.js";
import { createAndPersistSunoPromptPack } from "../services/sunoPromptPackFiles.js";
import { generateSunoRun, importSunoResults } from "../services/sunoRuns.js";

export function registerSunoTools(api: unknown): void {
  safeRegisterTool(api, {
    name: "artist_suno_create_prompt_pack",
    description: "Create and persist the Style, Exclude, lyrics, and payload files for a Suno song without submitting it.",
    handler: async (input) => {
      const payload = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
      return createAndPersistSunoPromptPack({
        workspaceRoot: typeof payload.workspaceRoot === "string" ? payload.workspaceRoot : ".",
        songId: typeof payload.songId === "string" ? payload.songId : "song-001",
        songTitle: typeof payload.songTitle === "string" ? payload.songTitle : "Untitled",
        artistReason: typeof payload.artistReason === "string" ? payload.artistReason : "bootstrap",
        lyricsText: typeof payload.lyricsText === "string" ? payload.lyricsText : "placeholder lyric",
        knowledgePackVersion: typeof payload.knowledgePackVersion === "string" ? payload.knowledgePackVersion : "local-dev"
      });
    }
  });

  safeRegisterTool(api, {
    name: "artist_suno_generate",
    description: "Run the configured Suno generation flow for an existing Artist Runtime song, subject to runtime safety gates.",
    handler: async (input) => {
      const payload = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
      return generateSunoRun({
        workspaceRoot: typeof payload.workspaceRoot === "string" ? payload.workspaceRoot : ".",
        songId: typeof payload.songId === "string" ? payload.songId : "song-001",
        config: typeof payload.config === "object" && payload.config !== null ? (payload.config as Record<string, unknown>) : undefined
      });
    }
  });

  safeRegisterTool(api, {
    name: "artist_suno_import_results",
    description: "Import known Suno result URLs or files for an existing Artist Runtime run.",
    handler: async (input) => {
      const payload = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
      return importSunoResults({
        workspaceRoot: typeof payload.workspaceRoot === "string" ? payload.workspaceRoot : ".",
        songId: typeof payload.songId === "string" ? payload.songId : "song-001",
        runId: typeof payload.runId === "string" ? payload.runId : "run-001",
        urls: Array.isArray(payload.urls) ? payload.urls.filter((value): value is string => typeof value === "string") : [],
        selectedTakeId: typeof payload.selectedTakeId === "string" ? payload.selectedTakeId : undefined,
        resultRefs: Array.isArray(payload.resultRefs) ? payload.resultRefs.filter((value): value is string => typeof value === "string") : [],
        config: typeof payload.config === "object" && payload.config !== null ? (payload.config as Record<string, unknown>) : undefined
      });
    }
  });
}
