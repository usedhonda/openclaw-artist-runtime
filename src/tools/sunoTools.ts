import { safeRegisterTool } from "../pluginApi.js";
import { createAndPersistSunoPromptPack } from "../services/sunoPromptPackFiles.js";
import { generateSunoRun, importSunoResults } from "../services/sunoRuns.js";
import { readResolvedConfig } from "../services/runtimeConfig.js";

export function registerSunoTools(api: unknown): void {
  safeRegisterTool(api, {
    name: "artist_suno_create_prompt_pack",
    description: "After the producer explicitly approves a song revision, create and persist its Style, Exclude, lyrics, and payload. Do not call for tentative discussion. This does not open Suno or submit Create.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["songId", "songTitle", "artistReason", "lyricsText"],
      properties: {
        songId: { type: "string", minLength: 1 },
        songTitle: { type: "string", minLength: 1 },
        artistReason: { type: "string", minLength: 1, description: "Approved creative and production direction, including the producer's requested revision." },
        lyricsText: { type: "string", minLength: 1 },
        moodHint: { type: "string" },
        knowledgePackVersion: { type: "string" }
      }
    },
    handler: async (input) => {
      const payload = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
      return createAndPersistSunoPromptPack({
        workspaceRoot: typeof payload.workspaceRoot === "string" ? payload.workspaceRoot : ".",
        songId: typeof payload.songId === "string" ? payload.songId : "song-001",
        songTitle: typeof payload.songTitle === "string" ? payload.songTitle : "Untitled",
        artistReason: typeof payload.artistReason === "string" ? payload.artistReason : "bootstrap",
        lyricsText: typeof payload.lyricsText === "string" ? payload.lyricsText : "placeholder lyric",
        moodHint: typeof payload.moodHint === "string" ? payload.moodHint : undefined,
        knowledgePackVersion: typeof payload.knowledgePackVersion === "string" ? payload.knowledgePackVersion : "local-dev"
      });
    }
  });

  safeRegisterTool(api, {
    name: "artist_suno_generate",
    description: "After explicit producer approval and a completed prompt-pack revision, run the configured Suno flow for that song. Persisted runtime settings control whether this stops before Create or submits; callers cannot override them.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["songId"],
      properties: {
        songId: { type: "string", minLength: 1 }
      }
    },
    handler: async (input) => {
      const payload = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
      const workspaceRoot = typeof payload.workspaceRoot === "string" ? payload.workspaceRoot : ".";
      return generateSunoRun({
        workspaceRoot,
        songId: typeof payload.songId === "string" ? payload.songId : "song-001",
        config: await readResolvedConfig(workspaceRoot)
      });
    }
  });

  safeRegisterTool(api, {
    name: "artist_suno_import_results",
    description: "Import known Suno result URLs or files for an existing Artist Runtime run.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["songId", "runId", "urls"],
      properties: {
        songId: { type: "string", minLength: 1 },
        runId: { type: "string", minLength: 1 },
        urls: { type: "array", items: { type: "string", minLength: 1 } },
        selectedTakeId: { type: "string" },
        resultRefs: { type: "array", items: { type: "string", minLength: 1 } }
      }
    },
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
