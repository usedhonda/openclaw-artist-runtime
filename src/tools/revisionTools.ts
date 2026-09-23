import { safeRegisterTool } from "../pluginApi.js";
import {
  adoptLyricRevision,
  listSongMaterialVersions,
  restoreLyricRevision,
  saveLyricRevision
} from "../services/songRevisions.js";
import { readSongMaterial } from "../services/songMaterialReader.js";
import { listSongStates } from "../services/artistState.js";
import { readLatestPromptPackMetadata } from "../services/sunoPromptPackFiles.js";
import { listSongProductionRevisions } from "../services/songProductionRevisions.js";
import { listProductionSubmissions, readProductionConversation, resolveProductionSubmission, updateProductionConversation } from "../services/productionConversation.js";

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
      type: "object", additionalProperties: false,
      properties: { songId: { type: "string", minLength: 1 }, query: { type: "string", minLength: 1 }, title: { type: "string", minLength: 1 }, replyMessageId: { type: "integer", minimum: 1, description: "Telegram message ID the producer is replying to; resolves the exact submitted trial within this conversation." }, includeMaterial: { type: "boolean" } }
    },
    handler: async (input, context) => {
      const payload = objectInput(input);
      const workspaceRoot = rootOf(payload);
      const conversation = await readProductionConversation(workspaceRoot, context);
      const replySubmission = typeof payload.replyMessageId === "number" ? await resolveProductionSubmission(workspaceRoot, context, payload.replyMessageId) : undefined;
      if (typeof payload.replyMessageId === "number" && !replySubmission) return { needsSong: true, reason: "The reply does not identify a unique trial in this conversation. Resolve its title rather than substituting the current song." };
      const suppliedSongId = typeof payload.songId === "string" && payload.songId ? payload.songId : undefined;
      if (replySubmission && suppliedSongId && replySubmission.songId !== suppliedSongId) throw new Error("reply target and song differ");
      const query = typeof payload.query === "string" ? payload.query : typeof payload.title === "string" ? payload.title : undefined;
      const explicitSongId = replySubmission?.songId ?? suppliedSongId ?? (!query ? conversation?.songId : undefined);
      if (!explicitSongId && !query) return { conversation: conversation ?? null, needsSong: true, reason: "No current song is established; ask for the title once." };
      const states = explicitSongId ? [] : (await listSongStates(workspaceRoot)).filter((song) => song.title.toLocaleLowerCase().includes(query!.toLocaleLowerCase()) || song.songId.toLocaleLowerCase() === query!.toLocaleLowerCase());
      if (!explicitSongId && states.length !== 1) {
        return { query, candidates: states.map((song) => ({ songId: song.songId, title: song.title, status: song.status, updatedAt: song.updatedAt })) };
      }
      const songId = explicitSongId ?? states[0]!.songId;
      const versions = await listSongMaterialVersions(workspaceRoot, songId);
      const [base, productionRevisions, submissions] = await Promise.all([
        readLatestPromptPackMetadata(workspaceRoot, songId),
        listSongProductionRevisions(workspaceRoot, songId),
        listProductionSubmissions(workspaceRoot, songId)
      ]);
      const activeConversation = await updateProductionConversation(workspaceRoot, context, { songId, ...(replySubmission ? { runId: replySubmission.runId, packVersion: replySubmission.packVersion, payloadHash: replySubmission.payloadHash, phase: "discussing" as const } : {}) });
      const shared = {
        songId, versions,
        base: base ? { packVersion: base.version, payloadHash: base.metadata.payloadHash } : undefined,
        conversation: activeConversation ?? conversation,
        productionRevisions: productionRevisions.map(({ revisionId, packVersion, payloadHash, producerInstruction, effective, lyric, baseline }) => ({ revisionId, packVersion, payloadHash, producerInstruction, effective, lyric, baseline })),
        submissions, replySubmission
      };
      return payload.includeMaterial === false ? shared : { ...shared, material: await readSongMaterial(workspaceRoot, songId) };
    }
  });

  safeRegisterTool(api, {
    name: "artist_lyrics_revision_save",
    description: "Save a durable, unadopted lyric candidate for an existing song. It never changes adopted material.",
    parameters: {
      type: "object", additionalProperties: false, required: ["songId", "instruction", "sourceKind", "sourceVersion", "expectedSourceHash"],
      properties: {
        songId: { type: "string", minLength: 1 }, instruction: { type: "string", minLength: 1 }, text: { type: "string" },
        sourceKind: { type: "string", enum: ["adopted_lyrics", "candidate"] }, sourceVersion: { type: "integer", minimum: 1 }, expectedSourceHash: { type: "string", minLength: 1 },
        changes: { type: "array", items: { type: "object", required: ["before", "after"], properties: { section: { type: "string" }, before: { type: "string" }, after: { type: "string" } }, additionalProperties: false } }
      }
    },
    handler: async (input) => {
      const payload = objectInput(input);
      const changes = Array.isArray(payload.changes) ? payload.changes : undefined;
      if ((payload.sourceKind !== "adopted_lyrics" && payload.sourceKind !== "candidate") || typeof payload.sourceVersion !== "number" || typeof payload.expectedSourceHash !== "string") throw new Error("sourceKind, sourceVersion, and expectedSourceHash are required");
      return saveLyricRevision({ workspaceRoot: rootOf(payload), songId: songIdOf(payload), instruction: String(payload.instruction ?? ""), text: typeof payload.text === "string" ? payload.text : undefined, changes: changes as never, source: { kind: payload.sourceKind, version: payload.sourceVersion }, expectedSourceHash: payload.expectedSourceHash });
    }
  });

  safeRegisterTool(api, {
    name: "artist_lyrics_revision_restore",
    description: "Restore an old lyric candidate into a new candidate; the source candidate is never rewritten.",
    parameters: {
      type: "object", additionalProperties: false, required: ["songId", "restoredFromKind", "restoredFromVersion", "ontoKind", "ontoVersion", "instruction"],
      properties: { songId: { type: "string", minLength: 1 }, restoredFromKind: { type: "string", enum: ["adopted_lyrics", "candidate"], description: "The old lyric material to restore from." }, restoredFromVersion: { type: "integer", minimum: 1 }, ontoKind: { type: "string", enum: ["adopted_lyrics", "candidate"], description: "The current lyric candidate to preserve and edit." }, ontoVersion: { type: "integer", minimum: 1 }, instruction: { type: "string", minLength: 1 }, expectedText: { type: "string" }, changes: { type: "array", items: { type: "object", required: ["before", "after"], properties: { section: { type: "string" }, before: { type: "string" }, after: { type: "string" } }, additionalProperties: false } } }
    },
    handler: async (input) => {
      const payload = objectInput(input);
      if ((payload.restoredFromKind !== "adopted_lyrics" && payload.restoredFromKind !== "candidate") || typeof payload.restoredFromVersion !== "number" || (payload.ontoKind !== "adopted_lyrics" && payload.ontoKind !== "candidate") || typeof payload.ontoVersion !== "number") throw new Error("restoredFromKind/restoredFromVersion and ontoKind/ontoVersion are required");
      return restoreLyricRevision({ workspaceRoot: rootOf(payload), songId: songIdOf(payload), restoredFromKind: payload.restoredFromKind, restoredFromVersion: payload.restoredFromVersion, ontoKind: payload.ontoKind, ontoVersion: payload.ontoVersion, instruction: String(payload.instruction ?? ""), changes: Array.isArray(payload.changes) ? payload.changes as never : undefined, expectedText: typeof payload.expectedText === "string" ? payload.expectedText : undefined });
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
