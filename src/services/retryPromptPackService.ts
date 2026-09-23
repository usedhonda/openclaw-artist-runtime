import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { ArtistRuntimeConfig } from "../types.js";
import { appendDopagakiMoodHint, decideDopagakiVariation } from "./creativeVariationPolicy.js";
import { appendAuditLog, createAuditEvent } from "./auditLog.js";
import { readAutopilotRunState, writeAutopilotRunState } from "./autopilotService.js";
import { readSongState, updateSongState } from "./artistState.js";
import { createAndPersistSunoPromptPack } from "./sunoPromptPackFiles.js";
import { readSongPlan } from "./songPlan.js";

export type RetryPromptPackResult =
  | { retried: false; statusCode: 409; reason: string }
  | { retried: false; statusCode: 422; reason: string }
  | { retried: true; statusCode: 200; songId: string; packVersion: number };

function songAuditPath(root: string, songId: string): string {
  return join(root, "songs", songId, "audit", "actions.jsonl");
}

export async function retryParkedSongPromptPack(
  workspaceRoot: string,
  songId: string,
  config: ArtistRuntimeConfig
): Promise<RetryPromptPackResult> {
  const song = await readSongState(workspaceRoot, songId).catch(() => undefined);
  if (!song || song.status !== "failed" || !song.lastReason?.startsWith("parked_needs_operator:")) {
    return {
      retried: false,
      statusCode: 409,
      reason: "song_is_not_a_parked_prompt_pack_failure"
    };
  }

  const lyricsVersion = song.lyricsVersion;
  if (!lyricsVersion) {
    return { retried: false, statusCode: 422, reason: "latest_lyrics_version_missing" };
  }
  const lyricsPath = join(workspaceRoot, "songs", songId, "lyrics", `lyrics.v${lyricsVersion}.md`);
  const lyricsText = await readFile(lyricsPath, "utf8").catch(() => "");
  if (!lyricsText.trim()) {
    return { retried: false, statusCode: 422, reason: "latest_lyrics_missing" };
  }

  const [briefText, moodHint] = await Promise.all([
    readFile(join(workspaceRoot, "songs", songId, "brief.md"), "utf8").catch(() => ""),
    readFile(join(workspaceRoot, "songs", songId, "mood-hint.txt"), "utf8").catch(() => "")
  ]);
  // Read the single dopagaki decision from the persisted plan; legacy songs
  // without a plan fall back to recomputing it here.
  const plan = await readSongPlan(workspaceRoot, songId);
  const variation = plan
    ? {
        active: plan.dopagaki.active,
        intensity: (plan.dopagaki.active ? "overt" : "off") as "overt" | "off",
        score: 0,
        threshold: plan.dopagaki.threshold,
        variationSeed: plan.dopagaki.variationSeed
      }
    : decideDopagakiVariation({ songId, date: song.createdAt, briefText });
  const observationPath = briefText.match(/^- Path:\s*(.+)$/m)?.[1]?.trim();

  let persisted;
  try {
    persisted = await createAndPersistSunoPromptPack({
      workspaceRoot,
      songId,
      songTitle: song.title,
      artistReason: song.lastReason,
      lyricsText,
      knowledgePackVersion: "local-dev",
      configSnapshot: config,
      creativeDecision: plan ?? undefined,
      moodHint: appendDopagakiMoodHint(moodHint.trim() || undefined, variation),
      styleVariationSeed: variation.variationSeed,
      observationPath: observationPath && observationPath !== "(runtime observation)"
        ? isAbsolute(observationPath) ? observationPath : join(workspaceRoot, observationPath)
        : undefined,
      aiReviewProvider: config.aiReview?.provider,
      deferDegradedNotification: true
    });
  } catch (error) {
    return {
      retried: false,
      statusCode: 422,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
  await updateSongState(workspaceRoot, songId, { degradedLyrics: false });
  const state = await readAutopilotRunState(workspaceRoot);
  await writeAutopilotRunState(workspaceRoot, {
    ...state,
    currentSongId: songId,
    stage: "suno_generation",
    paused: false,
    pausedReason: undefined,
    suspendedAt: undefined,
    blockedReason: undefined,
    lastError: undefined
  });
  await appendAuditLog(
    songAuditPath(workspaceRoot, songId),
    createAuditEvent({
      eventType: "retry_prompt_pack",
      actor: "producer",
      details: { songId, operator: "http", reason: "retry_prompt_pack", result: "suno_generation" }
    })
  );
  return { retried: true, statusCode: 200, songId, packVersion: persisted.packVersion };
}
