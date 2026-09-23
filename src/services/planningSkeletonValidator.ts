import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AiReviewProvider, PlanningSkeletonDraft } from "../types.js";
import { callAiProvider } from "./aiProviderClient.js";
import type { ChangeSetProposal } from "./freeformChangesetProposer.js";
import { secretLikePattern } from "./personaMigrator.js";

export interface PlanningCompletenessResult {
  complete: boolean;
  missing: string[];
  suggestions?: PlanningSkeletonDraft;
  proposal?: ChangeSetProposal;
  briefAbsent?: boolean;
}

export interface ValidatePlanningOptions {
  root?: string;
  aiReviewProvider?: AiReviewProvider;
  now?: Date;
}

const requiredFields = [
  { key: "title", pattern: /^#\s+.+|Song ID:/im },
  { key: "mood", pattern: /\bmood\b|ムード|気分/i },
  { key: "tempo", pattern: /\btempo\b|\b\d{2,3}\s*BPM\b|テンポ/i },
  { key: "duration", pattern: /\bduration\b|\d+\s*分|minutes?|尺/i },
  { key: "style notes", pattern: /\bstyle\b|style notes|arrangement|bass|drum|音像|編曲/i },
  { key: "lyrics theme", pattern: /lyrics theme|core theme|テーマ|歌詞/i }
] as const;

function assertSafe(stage: string, value: string): void {
  if (secretLikePattern.test(value)) {
    throw new Error(`planning_skeleton_secret_like_${stage}`);
  }
}

function missingFields(songMd: string, briefMd: string): string[] {
  const combined = `${songMd}\n${briefMd}`;
  return requiredFields.filter((field) => !field.pattern.test(combined)).map((field) => field.key);
}

function lineFor(field: string, songId: string): string {
  switch (field) {
    case "tempo":
      return "- Tempo: artist decides, medium-high pulse";
    case "duration":
      return "- Duration: artist decides, around 4 minutes";
    case "style notes":
      return "- Style notes: thick bass, restrained drums, unsentimental vocal delivery";
    case "lyrics theme":
      return `- Lyrics theme: ${songId} seen through the artist's current obsessions`;
    case "mood":
      return "- Mood: cold, observant, quietly obsessive";
    case "title":
      return `- Title: ${songId}`;
    default:
      return `- ${field}: artist decides`;
  }
}

function completeBrief(songId: string, briefMd: string, missing: string[]): string {
  const patch = [
    "## Planning Completion",
    "",
    ...missing.map((field) => lineFor(field, songId))
  ].join("\n");
  return `${briefMd.trim() || `# Brief for ${songId}`}\n\n${patch}`.trim();
}

function buildPrompt(songId: string, songMd: string, briefMd: string, missing: string[]): string {
  return [
    `Complete the planning skeleton for song ${songId}.`,
    `Missing fields: ${missing.join(", ")}`,
    "Return a concise full brief markdown with the missing fields filled. Do not include secrets.",
    "",
    "song.md:",
    songMd.slice(0, 1600),
    "",
    "brief.md:",
    briefMd.slice(0, 2000)
  ].join("\n");
}

function proposalFor(songId: string, completedBrief: string, missing: string[], now: Date): ChangeSetProposal {
  return {
    id: `planning-${songId}-${now.getTime().toString(36)}`,
    domain: "song",
    summary: `Planning skeleton completion for ${songId}.`,
    fields: [{
      domain: "song",
      targetFile: join("songs", songId, "brief.md"),
      field: "brief",
      proposedValue: completedBrief,
      reasoning: `fills missing planning fields: ${missing.join(", ")}`,
      status: "proposed"
    }],
    warnings: [],
    createdAt: now.toISOString(),
    source: "conversation",
    songId
  };
}

export async function validatePlanningCompleteness(
  songId: string,
  songMd: string,
  briefMd: string,
  options: ValidatePlanningOptions = {}
): Promise<PlanningCompletenessResult> {
  const inputText = `${songMd}\n${briefMd}`;
  assertSafe("input", inputText);
  const missing = missingFields(songMd, briefMd);
  if (missing.length === 0) {
    return { complete: true, missing: [] };
  }
  const now = options.now ?? new Date();
  const provider = options.aiReviewProvider ?? "mock";
  const raw = provider === "mock"
    ? completeBrief(songId, briefMd, missing)
    : await callAiProvider(buildPrompt(songId, songMd, briefMd, missing), { provider });
  assertSafe("ai_response", raw);
  const completedBrief = raw.trim();
  assertSafe("final", completedBrief);
  const proposal = proposalFor(songId, completedBrief, missing, now);
  return {
    complete: false,
    missing,
    suggestions: {
      songId,
      complete: false,
      missing,
      completedBrief,
      proposalId: proposal.id
    },
    proposal
  };
}

export async function validatePlanningFiles(root: string, songId: string, options: ValidatePlanningOptions = {}): Promise<PlanningCompletenessResult> {
  const songMd = await readFile(join(root, "songs", songId, "song.md"), "utf8").catch(() => "");
  const briefMd = await readFile(join(root, "songs", songId, "brief.md"), "utf8").catch(() => "");
  if (!songMd.trim() && !briefMd.trim()) {
    return { complete: false, missing: [], briefAbsent: true };
  }
  return validatePlanningCompleteness(songId, songMd, briefMd, { ...options, root });
}
