import { safeRegisterTool } from "../pluginApi.js";
import { reviseSongProduction, type ProductionRevisionPatch, type ProductionLyricRef } from "../services/songProductionRevisions.js";
import { readProductionConversation, updateProductionConversation } from "../services/productionConversation.js";

const objectInput = (input: unknown): Record<string, unknown> => typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
const workspace = (input: Record<string, unknown>) => typeof input.workspaceRoot === "string" ? input.workspaceRoot : ".";

export function registerProductionTools(api: unknown): void {
  safeRegisterTool(api, {
    name: "artist_production_conversation",
    description: "Read or remember the current producer-musician discussion: song, requested change, things to preserve, and unresolved choices. This is memory only, not approval, generation, or publication. Use before changing subjects or preparing an explicit production request so the work survives conversation compaction.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        songId: { type: "string", minLength: 1 },
        instruction: { type: "string", maxLength: 4000 },
        preserve: { type: "array", items: { type: "string", maxLength: 500 }, maxItems: 12 },
        direction: { type: "string", maxLength: 1500 },
        pendingDecision: { type: "string", maxLength: 1500 },
        phase: { type: "string", enum: ["discussing", "requested", "waiting"] }
      }
    },
    handler: async (input, context) => {
      const payload = objectInput(input);
      const root = workspace(payload);
      if (typeof payload.songId !== "string") return { conversation: await readProductionConversation(root, context) ?? null };
      if (context?.senderIsOwner === false) throw new Error("producer-only conversation update");
      const conversation = await updateProductionConversation(root, context, {
        songId: payload.songId,
        ...(typeof payload.instruction === "string" ? { instruction: payload.instruction } : {}),
        ...(Array.isArray(payload.preserve) ? { preserve: payload.preserve.filter((item): item is string => typeof item === "string") } : {}),
        ...(typeof payload.direction === "string" ? { direction: payload.direction } : {}),
        ...(typeof payload.pendingDecision === "string" ? { pendingDecision: payload.pendingDecision } : {}),
        ...(payload.phase === "discussing" || payload.phase === "requested" || payload.phase === "waiting" ? { phase: payload.phase } : {})
      });
      if (!conversation) throw new Error("trusted Telegram conversation context is unavailable");
      return { conversation };
    }
  });

  safeRegisterTool(api, {
    name: "artist_song_production_revise",
    description: "Apply an explicit producer request to an existing song's production: title, BPM, arrangement/vocal direction, or exclusions, with or without lyric changes. Preserve every unspecified field and original audio. This saves an exact new production pack but does not click Create or publish. A request to remake the song should continue using artist_suno_generate with the returned exact pack/hash.",
    parameters: {
      type: "object", additionalProperties: false,
      required: ["songId", "basePackVersion", "expectedBasePayloadHash", "lyric", "producerInstruction"],
      properties: {
        songId: { type: "string", minLength: 1 },
        basePackVersion: { type: "integer", minimum: 1 },
        expectedBasePayloadHash: { type: "string", minLength: 1 },
        producerInstruction: { type: "string", minLength: 1, maxLength: 4000 },
        lyric: { type: "object", additionalProperties: false, required: ["kind", "version", "hash"], properties: { kind: { type: "string", enum: ["adopted_lyrics", "candidate"] }, version: { type: "integer", minimum: 1 }, hash: { type: "string", minLength: 1 } } },
        patch: { type: "object", additionalProperties: false, properties: { title: { type: "string", minLength: 1 }, bpm: { type: "integer", minimum: 40, maximum: 220 }, direction: { type: "string", minLength: 1 }, excludeStyles: { type: "array", items: { type: "string", minLength: 1 } } } }
      }
    },
    handler: async (input, context) => {
      const payload = objectInput(input);
      if (context?.senderIsOwner === false) throw new Error("producer-only production revision");
      if (typeof payload.songId !== "string" || typeof payload.basePackVersion !== "number" || typeof payload.expectedBasePayloadHash !== "string" || typeof payload.producerInstruction !== "string") throw new Error("exact song, base pack, hash and producer instruction are required");
      const lyric = objectInput(payload.lyric);
      if ((lyric.kind !== "adopted_lyrics" && lyric.kind !== "candidate") || typeof lyric.version !== "number" || typeof lyric.hash !== "string") throw new Error("exact lyric reference is required");
      const root = workspace(payload);
      await updateProductionConversation(root, context, { songId: payload.songId, instruction: payload.producerInstruction, phase: "requested" });
      const revision = await reviseSongProduction({
        workspaceRoot: root,
        songId: payload.songId,
        basePackVersion: payload.basePackVersion,
        expectedBasePayloadHash: payload.expectedBasePayloadHash,
        lyric: lyric as unknown as ProductionLyricRef,
        producerInstruction: payload.producerInstruction,
        patch: objectInput(payload.patch) as ProductionRevisionPatch
      });
      await updateProductionConversation(root, context, {
        songId: revision.songId,
        instruction: revision.producerInstruction,
        direction: revision.effective.direction,
        revisionId: revision.revisionId,
        packVersion: revision.packVersion,
        payloadHash: revision.payloadHash,
        phase: "requested"
      });
      return {
        songId: revision.songId,
        revisionId: revision.revisionId,
        packVersion: revision.packVersion,
        payloadHash: revision.payloadHash,
        lyric: revision.lyric,
        effective: revision.effective,
        baseline: revision.baseline,
        validation: revision.promptPack.pack.validation,
        next: "For an explicit remake request, prepare this exact production pack with manual Create preserved."
      };
    }
  });
}
