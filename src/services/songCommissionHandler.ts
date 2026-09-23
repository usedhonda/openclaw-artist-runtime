import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AiReviewProvider, CommissionBrief, CommissionResult, SongUpdateField } from "../types.js";
import { readManagedCurrentState } from "./currentStateProjection.js";
import { secretLikePattern } from "./personaMigrator.js";
import { proposeFreeformChangeSet, type ChangeSetProposal } from "./freeformChangesetProposer.js";

export interface HandleCommissionOptions {
  brief: string;
  aiReviewProvider?: AiReviewProvider;
  now?: Date;
}

function shortId(input: string): string {
  const hash = createHash("sha256").update(input).update(randomBytes(4)).digest("hex").slice(0, 6);
  return `commission_${hash}`;
}

function titleFromBrief(value: string): string {
  const cleaned = value
    .replace(/^\/commission\b/i, "")
    .split(/[。、\n]/)[0]
    ?.replace(/(の話|について|系の曲を作って|曲を作って|こういうテーマで)/g, "")
    .trim();
  return cleaned ? cleaned.slice(0, 36) : "Commission Song";
}

function extractDuration(value: string): string {
  return value.match(/(\d+\s*(?:分|minutes?|min))/i)?.[1]?.replace(/\s+/g, " ") ?? "artist decides";
}

function extractTempo(value: string): string {
  return value.match(/(\d{2,3}\s*BPM)/i)?.[1] ?? "artist decides";
}

function extractStyle(value: string): string {
  const hits = [
    value.match(/\b(bass|ベース)\b[^。、\n]*/i)?.[0],
    value.match(/\b(jazz|drum|ドラム|city pop|hip[- ]?hop|dub|ambient)\b[^。、\n]*/i)?.[0]
  ].filter(Boolean);
  return hits.length ? [...new Set(hits)].join("; ") : "producer brief led, artist arrangement";
}

function normalizeDraft(fields: ChangeSetProposal["fields"], field: SongUpdateField, fallback: string): string {
  const value = fields.find((candidate) => candidate.field === field && candidate.status !== "skipped")?.proposedValue.trim();
  return value || fallback;
}

function guardSecret(stage: string, value: string): void {
  if (secretLikePattern.test(value)) {
    throw new Error(`commission_secret_like_${stage}`);
  }
}

function fieldValue(brief: CommissionBrief, field: string): string {
  switch (field) {
    case "title":
      return brief.title;
    case "brief":
      return brief.brief;
    case "lyricsTheme":
      return brief.lyricsTheme;
    case "mood":
      return brief.mood;
    case "tempo":
      return brief.tempo;
    case "style":
      return brief.styleNotes;
    case "duration":
      return brief.duration;
    default:
      return "";
  }
}

export function commissionBriefFromProposal(proposal: ChangeSetProposal): CommissionBrief | undefined {
  const lookup = (field: string, fallback: string) =>
    proposal.fields.find((candidate) => candidate.field === field && candidate.status !== "skipped")?.proposedValue.trim() || fallback;
  if (proposal.commissionBrief) {
    const base = proposal.commissionBrief;
    return {
      ...base,
      songId: lookup("songId", base.songId),
      title: lookup("title", fieldValue(base, "title") || base.title),
      brief: lookup("brief", fieldValue(base, "brief") || base.brief),
      lyricsTheme: lookup("lyricsTheme", fieldValue(base, "lyricsTheme") || base.lyricsTheme),
      mood: lookup("mood", fieldValue(base, "mood") || base.mood),
      tempo: lookup("tempo", fieldValue(base, "tempo") || base.tempo),
      styleNotes: lookup("style", fieldValue(base, "style") || base.styleNotes),
      duration: lookup("duration", fieldValue(base, "duration") || base.duration)
    };
  }
  if (proposal.source !== "commission") {
    return undefined;
  }
  return {
    songId: proposal.songId ?? `commission_${Date.now().toString(36)}`,
    title: lookup("title", proposal.songId ?? "Commission Song"),
    brief: lookup("brief", proposal.summary),
    lyricsTheme: lookup("lyricsTheme", lookup("brief", proposal.summary)),
    mood: lookup("mood", "producer-led urban observation"),
    tempo: lookup("tempo", "artist decides"),
    styleNotes: lookup("style", "producer brief led, artist arrangement"),
    duration: lookup("duration", "artist decides"),
    sourceText: lookup("sourceText", ""),
    createdAt: proposal.createdAt
  };
}

export async function handleCommission(root: string, options: HandleCommissionOptions): Promise<CommissionResult & { proposal: ChangeSetProposal }> {
  const rawBrief = options.brief.trim();
  guardSecret("input", rawBrief);
  if (!rawBrief) {
    throw new Error("commission_brief_required");
  }

  const now = options.now ?? new Date();
  const songId = shortId(`${rawBrief}:${now.toISOString()}`);
  const [currentState, songbookEntry] = await Promise.all([
    readManagedCurrentState(root),
    readFile(join(root, "artist", "SONGBOOK.md"), "utf8").catch(() => "")
  ]);
  const proposed = await proposeFreeformChangeSet({
    domain: "song",
    root,
    userMessage: rawBrief,
    songId,
    currentState,
    songbookEntry,
    aiReviewProvider: options.aiReviewProvider
  });
  const title = normalizeDraft(proposed.fields, "title", titleFromBrief(rawBrief));
  const brief = normalizeDraft(proposed.fields, "brief", rawBrief);
  const lyricsTheme = normalizeDraft(proposed.fields, "lyrics", rawBrief);
  const mood = normalizeDraft(proposed.fields, "notes", "producer-led, observational, unsentimental");
  const tempo = extractTempo(rawBrief);
  const roughStyle = extractStyle(rawBrief);
  const styleNotes = roughStyle === "producer brief led, artist arrangement"
    ? normalizeDraft(proposed.fields, "style", roughStyle)
    : roughStyle;
  const duration = extractDuration(rawBrief);
  const commissionBrief: CommissionBrief = {
    songId,
    title,
    brief,
    lyricsTheme,
    mood,
    tempo,
    styleNotes,
    duration,
    sourceText: rawBrief,
    createdAt: now.toISOString()
  };
  const finalText = JSON.stringify(commissionBrief);
  guardSecret("final", finalText);

  const fields = [
    { field: "songId", proposedValue: songId, reasoning: "generated commission id" },
    { field: "title", proposedValue: title, reasoning: "drafted from producer brief" },
    { field: "brief", proposedValue: brief, reasoning: "producer commission brief" },
    { field: "lyricsTheme", proposedValue: lyricsTheme, reasoning: "theme for lyrics planning" },
    { field: "mood", proposedValue: mood, reasoning: "artist interpretation" },
    { field: "tempo", proposedValue: tempo, reasoning: "parsed or left to artist" },
    { field: "duration", proposedValue: duration, reasoning: "parsed or left to artist" },
    { field: "style", proposedValue: styleNotes, reasoning: "production notes" }
  ].map((field) => ({
    domain: "song" as const,
    targetFile: join("songs", songId, "brief.md"),
    field: field.field,
    proposedValue: field.proposedValue,
    reasoning: field.reasoning,
    status: secretLikePattern.test(field.proposedValue) ? "skipped" as const : "proposed" as const
  }));

  const proposal: ChangeSetProposal = {
    id: `commission-${songId}`,
    domain: "song",
    summary: `Commission song proposal for ${songId}.`,
    fields,
    warnings: proposed.warnings,
    createdAt: now.toISOString(),
    source: "commission",
    songId,
    commissionBrief
  };
  return { proposal, proposalId: proposal.id, commissionBrief, warnings: proposal.warnings };
}
