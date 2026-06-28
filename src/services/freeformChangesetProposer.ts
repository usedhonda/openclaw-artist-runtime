import { join } from "node:path";
import type { AiReviewProvider, CommissionBrief, PersonaField, SongUpdateField, TelegramInlineKeyboard } from "../types.js";
import { proposePersonaFields } from "./personaProposer.js";
import { secretLikePattern } from "./personaMigrator.js";
import { proposeSongFields } from "./songProposer.js";

export type ChangeSetDomain = "persona" | "song";

export interface ChangeSetField {
  domain: ChangeSetDomain;
  targetFile: string;
  field: string;
  proposedValue: string;
  currentValue?: string;
  reasoning?: string;
  status: "proposed" | "skipped" | "low_confidence";
}

export interface ChangeSetProposal {
  id: string;
  domain: ChangeSetDomain;
  summary: string;
  fields: ChangeSetField[];
  warnings: string[];
  createdAt: string;
  source: "conversation" | "commission";
  songId?: string;
  platform?: string;
  commissionBrief?: CommissionBrief;
}

export interface FreeformChangeSetRequest {
  domain: ChangeSetDomain;
  root: string;
  userMessage: string;
  aiReviewProvider?: AiReviewProvider;
  songId?: string;
  artistMd?: string;
  soulMd?: string;
  songMd?: string;
  briefMd?: string;
  songbookEntry?: string;
  currentState?: string;
}

export interface ProposalInlineKeyboardCallbacks {
  yes: string;
  no: string;
  edit: string;
}

export function buildProposalInlineKeyboard(callbacks: ProposalInlineKeyboardCallbacks): TelegramInlineKeyboard {
  return [[
    { text: "Yes", callback_data: callbacks.yes },
    { text: "No", callback_data: callbacks.no },
    { text: "Edit", callback_data: callbacks.edit }
  ]];
}

function proposalId(domain: ChangeSetDomain): string {
  return `changeset-${domain}-${Date.now().toString(36)}`;
}

function personaTargetFile(field: PersonaField): string {
  if (field === "artistName" || field === "producerCallname") return "runtime/config-overrides.json";
  return field === "soul-tone" || field === "soul-refusal" ? "SOUL.md" : "ARTIST.md";
}

function songTargetFile(root: string, songId: string, field: SongUpdateField): string {
  if (field === "brief") {
    return join("songs", songId, "brief.md");
  }
  if (field === "lyrics") {
    return join("songs", songId, "lyrics", "lyrics.v1.md");
  }
  if (field.startsWith("publicLinks")) {
    return join("artist", "SONGBOOK.md");
  }
  return join("songs", songId, "song.md");
}

function secretWarning(value: string): string | undefined {
  return secretLikePattern.test(value) ? "input contains secret-like text; proposal skipped" : undefined;
}

export function parseFreeformChangeSetResponse(raw: string, domain: ChangeSetDomain): ChangeSetField[] {
  const fields: ChangeSetField[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([a-zA-Z][\w-]*)\s*:\s*(.*?)\s*(?:\(origin:\s*([^)]+)\))?\s*$/);
    if (!match) {
      continue;
    }
    fields.push({
      domain,
      targetFile: domain === "persona" ? "ARTIST.md" : "songs/<id>/song.md",
      field: match[1],
      proposedValue: match[2],
      reasoning: match[3],
      status: secretLikePattern.test(match[2]) ? "skipped" : "proposed"
    });
  }
  return fields;
}

export async function proposeFreeformChangeSet(req: FreeformChangeSetRequest): Promise<ChangeSetProposal> {
  const warning = secretWarning(req.userMessage);
  if (warning) {
    return {
      id: proposalId(req.domain),
      domain: req.domain,
      summary: "No change proposed because the input looked secret-like.",
      fields: [],
      warnings: [warning],
      createdAt: new Date().toISOString(),
      source: "conversation",
      songId: req.songId
    };
  }

  if (req.domain === "persona") {
    const fields: PersonaField[] = ["artistName", "identityLine", "soundDna", "obsessions", "lyricsRules", "socialVoice"];
    const result = await proposePersonaFields({
      fields,
      source: {
        artistMd: req.artistMd ?? "",
        soulMd: req.soulMd ?? "",
        roughInput: req.userMessage
      }
    }, { aiReviewProvider: req.aiReviewProvider });
    return {
      id: proposalId("persona"),
      domain: "persona",
      summary: "Persona changes proposed from conversation.",
      fields: result.drafts.map((draft) => ({
        domain: "persona",
        targetFile: personaTargetFile(draft.field),
        field: draft.field,
        proposedValue: draft.draft,
        reasoning: draft.reasoning,
        status: draft.status
      })),
      warnings: result.warnings,
      createdAt: new Date().toISOString(),
      source: "conversation"
    };
  }

  const songId = req.songId ?? "new-song";
  const fields: SongUpdateField[] = ["title", "brief", "style", "lyrics", "notes"];
  const result = await proposeSongFields({
    fields,
    source: {
      songId,
      songMd: req.songMd ?? "",
      briefMd: req.briefMd ?? "",
      songbookEntry: req.songbookEntry ?? "",
      currentState: req.currentState ?? "",
      roughInput: req.userMessage
    }
  }, { aiReviewProvider: req.aiReviewProvider });
  return {
    id: proposalId("song"),
    domain: "song",
    summary: `Song changes proposed from conversation for ${songId}.`,
    fields: result.drafts.map((draft) => ({
      domain: "song",
      targetFile: songTargetFile(req.root, songId, draft.field),
      field: draft.field,
      proposedValue: draft.draft,
      reasoning: draft.reasoning,
      status: draft.status
    })),
    warnings: result.warnings,
    createdAt: new Date().toISOString(),
    source: "conversation",
    songId
  };
}
