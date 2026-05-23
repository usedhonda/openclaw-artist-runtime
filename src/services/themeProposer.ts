import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AiReviewProvider } from "../types.js";
import { callAiProvider, isAiNotConfiguredResponse } from "./aiProviderClient.js";
import { readArtistVoiceContext } from "./artistVoiceResponder.js";
import { secretLikePattern } from "./personaMigrator.js";
import { extractPersonaMotifs, pickWeightedMotif, summarizeMotifs, type PersonaMotifBundle } from "./personaMotifExtractor.js";

export interface ThemeProposalContext {
  observations?: string;
  aiReviewProvider?: AiReviewProvider;
}

export interface ThemeProposal {
  theme: string;
  reason: string;
  provider: AiReviewProvider | "mock" | "not_configured";
  motifSummary?: string;
}

function truncate(value: string, maxLength: number): string {
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength - 3)}...`;
}

function parseTheme(raw: string): { theme: string; reason: string } {
  const theme = raw.match(/theme\s*:\s*(.+)/i)?.[1]?.trim();
  const reason = raw.match(/reason\s*:\s*(.+)/i)?.[1]?.trim();
  return {
    theme: theme || raw.split(/\r?\n/).find(Boolean)?.replace(/^[-*]\s*/, "").trim() || "signal in the ruins",
    reason: reason || "derived from current observations and artist context"
  };
}

function buildPrompt(artistMd: string, currentState: string, observations: string, motifSummary: string): string {
  return [
    "System: Propose one song theme for an autonomous public musical artist.",
    "Anchor the theme to the persona motifs below. Do not propose a theme that contradicts them.",
    "Return exactly two lines: theme: <one concise theme>; reason: <why this fits>.",
    "Do not include secrets, credentials, cookies, or private config.",
    "",
    `Persona motifs: ${motifSummary || "(none)"}`,
    "",
    "ARTIST.md:",
    truncate(artistMd, 2400),
    "",
    "artist/CURRENT_STATE.md:",
    truncate(currentState, 1200),
    "",
    "X observations:",
    truncate(observations, 2400)
  ].join("\n");
}

// Plan v10.38 Phase C: motif focus picker now uses pickWeightedMotif so the
// first ARTIST.md seed no longer wins every cycle. observationTopTags carry
// the day's X/news motif bias when available (Phase B/E hook); without them,
// the picker still rotates through the bundle weighted by ARTIST.md order.
function pickMotifFocus(
  motifs: PersonaMotifBundle,
  observationTopTags: string[] = [],
  rng?: () => number
): { theme: string; reason: string } {
  const primary = pickWeightedMotif(motifs.themes, observationTopTags, rng);
  const secondary = pickWeightedMotif(motifs.geographies, observationTopTags, rng);
  if (primary && secondary) {
    return {
      theme: `${primary}を${secondary}の視点から切る`,
      reason: `motifs(${primary}・${secondary}) と観察ログを照合し、アーティスト視座で自然に成立する切り口を選んだ`
    };
  }
  if (primary) {
    return {
      theme: `${primary}の構造を撃つ`,
      reason: `motifs(${primary}) が観察ログ全体を貫く核として浮かんだ`
    };
  }
  return {
    theme: "pressure building under public noise",
    reason: "mock provider derived the theme from observations"
  };
}

export async function proposeTheme(root: string, context: ThemeProposalContext = {}): Promise<ThemeProposal> {
  const voiceContext = await readArtistVoiceContext(root);
  const observations = context.observations ?? await readFile(join(root, "observations"), "utf8").catch(() => "");
  if (secretLikePattern.test(observations)) {
    throw new Error("theme_context_contains_secret_like_text");
  }
  const motifs = extractPersonaMotifs(voiceContext.artistMd);
  const motifSummary = summarizeMotifs(motifs);
  const provider = context.aiReviewProvider ?? "mock";
  let raw: string;
  let aiNotConfigured = false;
  if (provider === "mock") {
    const fallback = pickMotifFocus(motifs);
    raw = `theme: ${fallback.theme}\nreason: ${fallback.reason}`;
  } else {
    raw = await callAiProvider(
      buildPrompt(voiceContext.artistMd, voiceContext.currentState, observations, motifSummary),
      { provider }
    );
    if (isAiNotConfiguredResponse(raw)) {
      aiNotConfigured = true;
      const fallback = pickMotifFocus(motifs);
      raw = `theme: ${fallback.theme}\nreason: ${fallback.reason}`;
    }
  }
  if (secretLikePattern.test(raw)) {
    throw new Error("theme_response_contains_secret_like_text");
  }
  const parsed = parseTheme(raw);
  const reasonWithMotif = motifSummary
    ? `${parsed.reason} (motif anchor: ${motifSummary})`
    : parsed.reason;
  return {
    theme: parsed.theme,
    reason: reasonWithMotif,
    provider: aiNotConfigured ? "not_configured" : provider,
    motifSummary: motifSummary || undefined
  };
}
