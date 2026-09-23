import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { safeRegisterTool } from "../pluginApi.js";
import { assertProducer } from "../services/telegramAuth.js";
import { createAndPersistSunoPromptPack } from "../services/sunoPromptPackFiles.js";
import { generateSunoRun, importSunoResults } from "../services/sunoRuns.js";
import type { SunoRunRecord } from "../types.js";
import { readResolvedConfig } from "../services/runtimeConfig.js";
import { emitRuntimeEvent } from "../services/runtimeEventBus.js";
import { findProductionRunForPack, productionContextIdentity, updateProductionConversation } from "../services/productionConversation.js";
import { evaluateHumanAssistPending } from "../services/humanAssistPending.js";
import { enqueueProductionPreparation } from "../services/productionPreparationQueue.js";
import { readSongState } from "../services/artistState.js";

const productionRequests = new Map<string, Promise<unknown>>();

async function singleProductionRequest(key: string, operation: () => Promise<unknown>): Promise<unknown> {
  const existing = productionRequests.get(key);
  if (existing) return existing;
  const current = Promise.resolve().then(operation);
  productionRequests.set(key, current);
  try { return await current; } finally { if (productionRequests.get(key) === current) productionRequests.delete(key); }
}

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
      required: ["songId", "expectedPayloadHash", "expectedPackVersion"],
      properties: {
        songId: { type: "string", minLength: 1 },
        expectedPayloadHash: { type: "string", minLength: 1 },
        expectedPackVersion: { type: "integer", minimum: 1 },
        prepareOnly: { type: "boolean", description: "Prepare-only safety assertion: allowed only with submitMode=manual; fills the form without Create." },
        retryPreparation: { type: "boolean", description: "Only after a new explicit producer request to reopen a failed/interrupted manual preparation. Never use to duplicate an accepted generation." }
      }
    },
    handler: async (input, context) => {
      assertProducer(context, "Suno generation");
      const payload = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
      const workspaceRoot = typeof payload.workspaceRoot === "string" ? payload.workspaceRoot : ".";
      const expectedPayloadHash = typeof payload.expectedPayloadHash === "string" ? payload.expectedPayloadHash : undefined;
      const expectedPackVersion = typeof payload.expectedPackVersion === "number" ? payload.expectedPackVersion : undefined;
      if (expectedPayloadHash === undefined || expectedPackVersion === undefined) {
        throw new Error("conversational Suno generation requires expectedPayloadHash and expectedPackVersion");
      }
      return singleProductionRequest(JSON.stringify([workspaceRoot, payload.songId, expectedPackVersion, expectedPayloadHash]), async () => {
      const generationInput = {
        workspaceRoot,
        songId: typeof payload.songId === "string" ? payload.songId : "song-001",
        config: await readResolvedConfig(workspaceRoot),
        expectedPayloadHash,
        expectedPackVersion,
        prepareOnly: payload.prepareOnly === true,
        conversational: true,
        conversationContext: context
      };
      if (generationInput.prepareOnly && generationInput.config.music.suno.submitMode !== "manual") throw new Error("prepareOnly requires Suno submitMode=manual");
      const existing = await findProductionRunForPack(workspaceRoot, generationInput.songId, expectedPackVersion, expectedPayloadHash);
      if (existing) {
        const runLedger = await readFile(join(workspaceRoot, "songs", generationInput.songId, "suno", "runs.jsonl"), "utf8")
          .catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return ""; throw error; });
        const result = runLedger.split("\n").filter(Boolean).map((line) => JSON.parse(line) as SunoRunRecord).reverse().find((run) => run.runId === existing.runId);
        if (result && (result.status === "accepted" || result.status === "imported")) return result;
        const marker = await readFile(join(workspaceRoot, "runtime", "suno", "human-assist-pending.json"), "utf8")
          .then((raw) => JSON.parse(raw) as { pid?: number; runId?: string }).catch(() => undefined);
        if (marker?.pid === process.pid && marker.runId === existing.runId) return { status: "prepared", songId: existing.songId, runId: existing.runId, manualSubmitRequired: true, payloadHash: existing.payloadHash, packVersion: existing.packVersion, createClicked: false };
        if (payload.retryPreparation !== true) return result ?? { status: "interrupted", songId: existing.songId, runId: existing.runId, reason: "The prior preparation no longer has a live wait. Do not regenerate without an explicit producer request to reopen it." };
      }
      const busy = generationInput.prepareOnly ? await evaluateHumanAssistPending(workspaceRoot) : undefined;
      if (busy) {
        const queued = await enqueueProductionPreparation(workspaceRoot, { songId: generationInput.songId, packVersion: expectedPackVersion, payloadHash: expectedPayloadHash, contextKey: productionContextIdentity(context)?.key });
        await updateProductionConversation(workspaceRoot, context, { songId: generationInput.songId, packVersion: expectedPackVersion, payloadHash: expectedPayloadHash, phase: "waiting" });
        const waitingSong = await readSongState(workspaceRoot, busy.songId);
        return { status: "queued", songId: generationInput.songId, waitingForTitle: waitingSong.title, preparation: queued, manualSubmitRequired: true, createClicked: false };
      }
      if (!generationInput.prepareOnly) {
        return generateSunoRun(generationInput);
      }
      let preparedRunId = "pending";
      let signalReady!: () => void;
      const preparedSignal = new Promise<void>((resolve) => {
        signalReady = resolve;
      });
      const generation = generateSunoRun({
        ...generationInput,
        onPrepared: ({ runId }) => {
          preparedRunId = runId;
          signalReady();
        }
      });
      const raced = await Promise.race([
        preparedSignal.then(() => ({ kind: "prepared" as const })),
        generation.then((result) => ({ kind: "completed" as const, result }), () => ({ kind: "rejected" as const }))
      ]);
      if (raced.kind === "prepared") {
        // The background create remains responsible for the eventual terminal
        // result and ledger append. Consume a later rejection without exposing
        // raw browser/network details to the tool caller.
        void generation.catch(() => {
          console.error("[suno] prepare-only background generation failed");
          emitRuntimeEvent({
            type: "error",
            source: "suno_prepare_only",
            reason: "suno_prepare_only_background_failed",
            songId: generationInput.songId,
            timestamp: Date.now()
          });
        });
        return {
          status: "prepared",
          songId: generationInput.songId,
          runId: preparedRunId,
          manualSubmitRequired: true,
          payloadHash: expectedPayloadHash,
          packVersion: expectedPackVersion,
          createClicked: false
        };
      }
      if (raced.kind === "rejected") {
        throw new Error("Suno preparation failed");
      }
      return raced.result;
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
