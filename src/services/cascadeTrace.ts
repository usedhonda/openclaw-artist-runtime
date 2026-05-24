import type { CascadeTrace, CascadeTraceSource, ObservationSummary } from "../types.js";
import { secretLikePattern } from "./personaMigrator.js";

export interface BuildCascadeTraceInput {
  songId: string;
  brief?: string;
  title?: string;
  artistVoice?: string;
  lyricsTheme?: string;
  styleLayer?: string;
  observationSummary?: ObservationSummary;
}

function pickBriefField(brief: string | undefined, label: string): string | undefined {
  if (!brief) return undefined;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return brief.match(new RegExp(`^-\\s*${escaped}:\\s*(.+)$`, "im"))?.[1]?.trim();
}

function compactTraceLine(value: string | undefined, fallback: string, limit = 120): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function isPublicXUrl(value: string | undefined): boolean {
  return /^https:\/\/(?:x|twitter)\.com\/[^/\s]+\/status\/\d+/i.test(value ?? "");
}

function safeTraceQuote(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (secretLikePattern.test(value)) return "[非表示]";
  return compactTraceLine(value.replace(/@[A-Za-z0-9_]{1,20}/g, "[handle]"), value, 120);
}

function sourceFromBrief(brief: string | undefined): CascadeTraceSource | undefined {
  if (!brief) return undefined;
  const url = brief.match(/https?:\/\/\S+/)?.[0]?.replace(/[)）\]、。,]+$/g, "");
  const quote = brief.match(/^- Quote:\s*(.+)$/im)?.[1]?.trim()
    ?? brief.match(/^- Source quote:\s*(.+)$/im)?.[1]?.trim();
  const author = brief.match(/^- Author:\s*(.+)$/im)?.[1]?.trim();
  if (!url && !quote && !author) return undefined;
  return {
    kind: isPublicXUrl(url) ? "x" : "unknown",
    label: author ? `@${author.replace(/^@/, "")}` : "brief source",
    author,
    quote: safeTraceQuote(quote),
    url: isPublicXUrl(url) ? url : undefined
  };
}

function sourceFromSummary(summary: ObservationSummary | undefined): CascadeTraceSource | undefined {
  if (!summary) return undefined;
  return {
    kind: isPublicXUrl(summary.url) ? "x" : "unknown",
    label: summary.author ? `@${summary.author.replace(/^@/, "")}` : "observation",
    author: summary.author,
    quote: safeTraceQuote(summary.quote),
    url: isPublicXUrl(summary.url) ? summary.url : undefined
  };
}

export function buildCascadeTrace(input: BuildCascadeTraceInput): CascadeTrace {
  const primarySource = sourceFromBrief(input.brief) ?? sourceFromSummary(input.observationSummary);
  return {
    observationSources: primarySource ? [primarySource] : [],
    artistVoice: compactTraceLine(input.artistVoice?.split(/\r?\n/)[0], "未記録", 100),
    title: compactTraceLine(input.title || input.songId, input.songId, 80),
    lyricsTheme: compactTraceLine(
      pickBriefField(input.brief, "Lyrics theme")
        ?? pickBriefField(input.brief, "Core theme")
        ?? input.lyricsTheme,
      "未記録"
    ),
    styleLayer: compactTraceLine(pickBriefField(input.brief, "Style notes") ?? input.styleLayer, "未記録")
  };
}

function formatSource(source: CascadeTraceSource | undefined): string {
  if (!source) return "未記録";
  const quote = source.quote ? `「${source.quote}」` : "引用なし";
  return source.url ? `${source.label}: ${quote} ${source.url}` : `${source.label}: ${quote}`;
}

export function formatCascadeTrace(trace: CascadeTrace): string {
  return [
    "行程 trace:",
    `- 観察 source: ${formatSource(trace.observationSources[0])}`,
    `- artist voice: ${trace.artistVoice}`,
    `- title: ${trace.title}`,
    `- lyrics theme: ${trace.lyricsTheme}`,
    `- style layer: ${trace.styleLayer}`
  ].join("\n");
}
