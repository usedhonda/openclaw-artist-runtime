import { safeRegisterTool } from "../pluginApi.js";
import {
  adoptLyricRevision,
  listSongMaterialVersions,
  restoreLyricRevision,
  saveLyricRevision
} from "../services/songRevisions.js";
import { readSongMaterial } from "../services/songMaterialReader.js";

function objectInput(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
}

function rootOf(payload: Record<string, unknown>): string {
  return typeof payload.workspaceRoot === "string" ? payload.workspaceRoot : ".";
}

function songIdOf(payload: Record<string, unknown>): string {
  if (typeof payload.songId !== "string" || !payload.songId) throw new Error("existing songId is required");
  return payload.songId;
}

export function registerRevisionTools(api: unknown): void {
  safeRegisterTool(api, {
    name: "artist_song_material_lookup",
    description: "Look up an existing song's adopted material and isolated lyric revision candidates.",
    parameters: {
      type: "object", additionalProperties: false, required: ["songId"],
      properties: { songId: { type: "string", minLength: 1 }, includeMaterial: { type: "boolean" } }
    },
    handler: async (input) => {
      const payload = objectInput(input);
      const workspaceRoot = rootOf(payload);
      const songId = songIdOf(payload);
      const versions = await listSongMaterialVersions(workspaceRoot, songId);
      return payload.includeMaterial === false ? { songId, versions } : { songId, material: await readSongMaterial(workspaceRoot, songId), versions };
    }
  });

  safeRegisterTool(api, {
    name: "artist_lyrics_revision_save",
    description: "Save a durable, unadopted lyric candidate for an existing song. It never changes adopted material.",
    parameters: {
      type: "object", additionalProperties: false, required: ["songId", "instruction"],
      properties: {
        songId: { type: "string", minLength: 1 }, instruction: { type: "string", minLength: 1 }, text: { type: "string" },
        sourceVersion: { type: "integer", minimum: 1 }, expectedSourceText: { type: "string" },
        changes: { type: "array", items: { type: "object", required: ["before", "after"], properties: { section: { type: "string" }, before: { type: "string" }, after: { type: "string" } }, additionalProperties: false } }
      }
    },
    handler: async (input) => {
      const payload = objectInput(input);
      const changes = Array.isArray(payload.changes) ? payload.changes : undefined;
      return saveLyricRevision({ workspaceRoot: rootOf(payload), songId: songIdOf(payload), instruction: String(payload.instruction ?? ""), text: typeof payload.text === "string" ? payload.text : undefined, changes: changes as never, sourceVersion: typeof payload.sourceVersion === "number" ? payload.sourceVersion : undefined, expectedSourceText: typeof payload.expectedSourceText === "string" ? payload.expectedSourceText : undefined });
    }
  });

  safeRegisterTool(api, {
    name: "artist_lyrics_revision_restore",
    description: "Restore an old lyric candidate into a new candidate; the source candidate is never rewritten.",
    parameters: {
      type: "object", additionalProperties: false, required: ["songId", "version", "instruction"],
      properties: { songId: { type: "string", minLength: 1 }, version: { type: "integer", minimum: 1 }, instruction: { type: "string", minLength: 1 }, text: { type: "string" }, expectedText: { type: "string" }, changes: { type: "array", items: { type: "object", required: ["before", "after"], properties: { section: { type: "string" }, before: { type: "string" }, after: { type: "string" } }, additionalProperties: false } } }
    },
    handler: async (input) => {
      const payload = objectInput(input);
      return restoreLyricRevision({ workspaceRoot: rootOf(payload), songId: songIdOf(payload), version: Number(payload.version), instruction: String(payload.instruction ?? ""), text: typeof payload.text === "string" ? payload.text : undefined, changes: Array.isArray(payload.changes) ? payload.changes as never : undefined, expectedText: typeof payload.expectedText === "string" ? payload.expectedText : undefined });
    }
  });

  safeRegisterTool(api, {
    name: "artist_lyrics_revision_adopt",
    description: "Explicitly adopt one existing-song lyric candidate and generate the exact approved Suno payload.",
    parameters: {
      type: "object", additionalProperties: false, required: ["songId", "version", "artistReason", "expectedTextHash"],
      properties: { songId: { type: "string", minLength: 1 }, version: { type: "integer", minimum: 1 }, artistReason: { type: "string", minLength: 1 }, expectedTextHash: { type: "string", minLength: 1 }, songTitle: { type: "string" } }
    },
    handler: async (input) => {
      const payload = objectInput(input);
      return adoptLyricRevision({ workspaceRoot: rootOf(payload), songId: songIdOf(payload), version: Number(payload.version), artistReason: String(payload.artistReason ?? ""), expectedTextHash: String(payload.expectedTextHash ?? ""), songTitle: typeof payload.songTitle === "string" ? payload.songTitle : undefined });
    }
  });
}
