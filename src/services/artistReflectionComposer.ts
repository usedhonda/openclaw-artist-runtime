import { createHash } from "node:crypto";
import type { CascadeTrace, CascadeTraceSource, CommissionBrief, ObservationSummary } from "../types.js";
import { buildCascadeTrace } from "./cascadeTrace.js";
import { readArtistVoiceContext } from "./artistVoiceResponder.js";
import { extractPersonaMotifs } from "./personaMotifExtractor.js";
import { secretLikePattern } from "./personaMigrator.js";
import { parseVoiceFingerprint } from "./voiceFingerprintParser.js";

export interface ComposeArtistReflectionInput {
  workspaceRoot?: string;
  songId: string;
  brief: CommissionBrief;
  reason: string;
  voiceTop?: string;
  observationSummary?: ObservationSummary;
  seed?: string;
}

export interface ArtistReflectionResult {
  narrative: string;
  cascadeTrace: CascadeTrace;
}

function hashIndex(seed: string, modulo: number, offset = 0): number {
  if (modulo <= 1) return 0;
  const digest = createHash("sha256").update(`${seed}:${offset}`).digest();
  return digest.readUInt32BE(0) % modulo;
}

function compact(value: string | undefined, fallback: string, limit = 140): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text || secretLikePattern.test(text)) return fallback;
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function isMachineReason(value: string | undefined): boolean {
  return /(?:motif anchor:|themes:|geo:|vocab:|sound:|ARTIST\.md|SOUL\.md|に基づき|変換した)/i.test(value ?? "");
}

function quoteLine(source: CascadeTraceSource | undefined, fallback: string): string {
  if (!source?.quote) return fallback;
  const label = source.url ? `${source.label} · ${source.url}` : source.label;
  return `「${source.quote}」 — ${label}`;
}

function splitSources(trace: CascadeTrace): { news?: CascadeTraceSource; x?: CascadeTraceSource; first?: CascadeTraceSource } {
  return {
    news: trace.observationSources.find((source) => source.kind === "news"),
    x: trace.observationSources.find((source) => source.kind === "x"),
    first: trace.observationSources[0]
  };
}

async function readPersona(root: string | undefined): Promise<{
  callname: string;
  firstPerson: string;
  ending: string;
  motif: string;
}> {
  if (!root) return { callname: "プロデューサー", firstPerson: "俺", ending: "だ。", motif: "今の違和感" };
  const context = await readArtistVoiceContext(root).catch(() => null);
  const soul = context?.soulMd ?? "";
  const artist = context?.artistMd ?? "";
  const fingerprint = soul ? parseVoiceFingerprint(soul) : null;
  const motifs = extractPersonaMotifs([artist, soul, context?.identityMd ?? "", context?.innerMd ?? "", context?.producerMd ?? ""].join("\n"));
  const motif = motifs.themes[0] ?? motifs.vocabulary[0] ?? motifs.geographies[0] ?? "今の違和感";
  return {
    callname: fingerprint?.producerCallname?.trim() || "プロデューサー",
    firstPerson: fingerprint?.firstPerson?.trim() || "俺",
    ending: fingerprint?.sentenceEndings?.[0]?.trim() || "だ。",
    motif
  };
}

function stripPeriod(value: string): string {
  return value.replace(/[。.!?！？]+$/u, "").trim();
}

export async function composeArtistReflection(input: ComposeArtistReflectionInput): Promise<ArtistReflectionResult> {
  const cascadeTrace = buildCascadeTrace({
    songId: input.songId,
    title: input.brief.title,
    artistVoice: input.voiceTop,
    lyricsTheme: input.brief.lyricsTheme,
    styleLayer: input.brief.styleNotes,
    observationSummary: input.observationSummary,
    commissionSources: input.brief.sources
  });
  const persona = await readPersona(input.workspaceRoot);
  const seed = input.seed ?? input.songId;
  const { news, x, first } = splitSources(cascadeTrace);
  const feeling = ["胸に残った", "無視できなかった", "音に戻したくなった", "黙って通れなかった"][hashIndex(seed, 4, 1)];
  const title = compact(input.brief.title, input.songId, 80);
  const lyricsTheme = compact(input.brief.lyricsTheme, "まだ言葉の輪郭だけある", 180);
  const styleLayer = compact(input.brief.styleNotes, "音はこれから削る", 180);
  const reason = compact(isMachineReason(input.reason) ? undefined : input.reason, `${persona.motif}に引っかかった。委ねてみたい。`, 120);
  const voice = compact(input.voiceTop, `${persona.callname}、次の曲の話をしたい。`, 120);

  const observationLines = first
    ? [
        `${persona.callname}、今日、こんな観察が引っかかった。`,
        quoteLine(news ?? first, "出どころの短い断片が残った。"),
        x && x !== news ? `X でも見た。${quoteLine(x, "同じ匂いの声があった。")}` : undefined
      ].filter(Boolean)
    : [
        `${persona.callname}、今日は外の観察が薄い。`,
        `${persona.firstPerson}の中に残っている${persona.motif}だけで、まず話す。`
      ];

  const narrative = [
    ...observationLines,
    "",
    `これを読んで、${persona.firstPerson}は${feeling}${persona.ending}`,
    `『${title}』では、${stripPeriod(lyricsTheme)}。${styleLayer}`,
    `理由は、${reason}`,
    "",
    `voice: ${voice}`,
    `title: ${title}`,
    `lyrics: ${lyricsTheme}`,
    `style: ${styleLayer}`
  ].join("\n");

  return { narrative, cascadeTrace };
}
