import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AiReviewProvider, DailyVoiceDraft } from "../types.js";
import { callAiProvider } from "./aiProviderClient.js";
import { listSongStates } from "./artistState.js";
import { secretLikePattern } from "./personaMigrator.js";

export interface ComposeDailyVoiceOptions {
  aiReviewProvider?: AiReviewProvider;
  now?: Date;
}

const maxBodyChars = 256;
const sourceUrlPattern = /https:\/\/(?:t\.co\/[A-Za-z0-9]+|(?:twitter|x)\.com\/[^/\s]+\/status\/\d+)/i;

export interface DailyVoiceObservation {
  text: string;
  author?: string;
  url?: string;
  postedAt?: string;
}

let warnedLegacyObservationFormat = false;

function assertSafe(label: string, value: string): void {
  if (secretLikePattern.test(value)) {
    throw new Error(`${label}_contains_secret_like_text`);
  }
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

export function hashDailyVoiceDraft(value: string): string {
  return createHash("sha256").update(normalizeText(value)).digest("hex");
}

function collapseRepeatedSentences(value: string): string {
  const segments = normalizeText(value).match(/[^。.!?\n]+[。.!?]?|\n+/g) ?? [normalizeText(value)];
  const output: string[] = [];
  let previousKey = "";
  for (const segment of segments) {
    const trimmed = segment.trim();
    const key = trimmed.replace(/[。.!?]+$/g, "").trim();
    if (key.length >= 8 && key === previousKey) {
      continue;
    }
    output.push(segment);
    if (key) {
      previousKey = key;
    }
  }
  return output.join("").replace(/\n{3,}/g, "\n\n").trim();
}

export function fitDailyVoiceDraft(value: string): string {
  const compact = normalizeText(value)
    .replace(/#[\p{L}\p{N}_-]+/gu, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const deduped = collapseRepeatedSentences(compact);
  const chars = Array.from(deduped);
  if (chars.length <= maxBodyChars) {
    return deduped;
  }
  const room = maxBodyChars - 1;
  const sliced = chars.slice(0, room).join("");
  const boundary = Math.max(
    sliced.lastIndexOf("。"),
    sliced.lastIndexOf("、"),
    sliced.lastIndexOf("."),
    sliced.lastIndexOf(" "),
    sliced.lastIndexOf("\n")
  );
  return `${(boundary > Math.floor(room * 0.5) ? sliced.slice(0, boundary) : sliced).trim()}…`;
}

function fitDraft(value: string): string {
  return fitDailyVoiceDraft(value);
}

function parseJsonValue(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "null" || !trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return trimmed.replace(/^["']|["']$/g, "");
  }
}

export function parseDailyVoiceObservations(markdown: string): DailyVoiceObservation[] {
  const entries: DailyVoiceObservation[] = [];
  let current: Partial<DailyVoiceObservation> | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    const start = line.match(/^-\s+text:\s*(.*)$/);
    if (start) {
      if (current?.text) {
        entries.push(current as DailyVoiceObservation);
      }
      current = { text: parseJsonValue(start[1]) ?? "" };
      continue;
    }
    const field = line.match(/^\s+(author|url|postedAt):\s*(.*)$/);
    if (field && current) {
      const value = parseJsonValue(field[2]);
      if (value) {
        current[field[1] as "author" | "url" | "postedAt"] = value;
      }
    }
  }
  if (current?.text) {
    entries.push(current as DailyVoiceObservation);
  }
  return entries;
}

function selectObservation(observation: string): DailyVoiceObservation | undefined {
  const entries = parseDailyVoiceObservations(observation);
  if (observation.trim() && entries.length === 0 && !warnedLegacyObservationFormat) {
    warnedLegacyObservationFormat = true;
    console.warn("[artist-runtime] daily voice skipped legacy observation format");
  }
  return entries.find((entry) => entry.url) ?? entries[0];
}

const dailyVoiceFields = ["selected_url", "selected_author", "opinion", "rationale"] as const;

function parseField(raw: string, field: (typeof dailyVoiceFields)[number]): string | undefined {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundary = dailyVoiceFields.filter((name) => name !== field).join("|");
  const match = raw.match(new RegExp(`(?:^|\\s)${escaped}:\\s*([\\s\\S]*?)(?=\\s*(?:${boundary}):\\s*|$)`, "im"));
  return match?.[1]?.trim() || undefined;
}

function summarizePersonaBasis(artistMd: string, soulMd: string): { obsession: string; tone: string } {
  return {
    obsession: artistMd.match(/obsessions?:\s*(.+)/i)?.[1]?.trim() ?? "ARTIST.md の基礎人格",
    tone: soulMd.match(/tone:\s*(.+)/i)?.[1]?.trim() ?? "SOUL.md の基礎トーン"
  };
}

function fitRationale(value: string): string {
  return fitDraft(value).replace(/\n{3,}/g, "\n\n");
}

function observationCore(selected?: DailyVoiceObservation): string {
  return selected?.text ? selected.text.slice(0, 52) : "今日の観察全体";
}

function structuredRationale(basis: { obsession: string; tone: string }, selected?: DailyVoiceObservation): string {
  return fitRationale(`ARTIST.md の「${basis.obsession}」と SOUL.md の「${basis.tone}」に基づき、observation「${observationCore(selected)}」を社会の違和感として artist の声に変換した。`);
}

function isJapaneseText(value: string): boolean {
  return /[ぁ-んァ-ヶ一-龠]/.test(value);
}

function parsePost(raw: string, selected: DailyVoiceObservation | undefined, basis: { obsession: string; tone: string }): { opinion: string; url?: string; author?: string; rationale?: string } {
  const normalized = normalizeText(raw);
  const selectedUrl = parseField(normalized, "selected_url");
  const selectedAuthor = parseField(normalized, "selected_author");
  const fieldOpinion = parseField(normalized, "opinion");
  const fieldRationale = parseField(normalized, "rationale");
  const url = (selectedUrl && selectedUrl !== "none" ? selectedUrl.match(sourceUrlPattern)?.[0] : undefined)
    ?? normalized.match(sourceUrlPattern)?.[0]
    ?? selected?.url;
  const opinionSource = fieldOpinion ?? (url ? normalized.replace(url, "") : normalized);
  return {
    opinion: fitDraft(opinionSource),
    url,
    author: selectedAuthor && selectedAuthor !== "none" ? selectedAuthor.replace(/^@/, "") : selected?.author,
    rationale: fieldRationale && isJapaneseText(fieldRationale) ? fitRationale(fieldRationale) : structuredRationale(basis, selected)
  };
}

function buildDraftText(opinion: string, url?: string): string {
  return url ? `${opinion}\n\n${url}` : opinion;
}

function anon(label: string, value: string, max = 120): string {
  const safe = value
    .split(/\r?\n/)
    .map((line) => secretLikePattern.test(line) ? "[private line redacted]" : line.trim())
    .filter(Boolean)
    .join(" ");
  return `${label}: ${safe.slice(0, max)}`;
}

async function latestObservation(root: string): Promise<string> {
  const dir = join(root, "observations");
  const entries = await readdir(dir).catch(() => []);
  const latest = entries.filter((entry) => entry.endsWith(".md")).sort().at(-1);
  return latest ? readFile(join(dir, latest), "utf8").catch(() => "") : "";
}

async function latestSongFragment(root: string): Promise<string> {
  const songs = await listSongStates(root).catch(() => []);
  const latest = songs[0];
  if (!latest) {
    return "";
  }
  const [brief, style, lyrics] = await Promise.all([
    readFile(join(root, "songs", latest.songId, "brief.md"), "utf8").catch(() => ""),
    readFile(join(root, "songs", latest.songId, "style.md"), "utf8").catch(() => ""),
    readFile(join(root, "songs", latest.songId, "lyrics.md"), "utf8").catch(() => "")
  ]);
  return [latest.title, latest.lastReason, brief, style, lyrics].filter(Boolean).join("\n");
}

function mockDraft(context: { artistMd: string; soulMd: string; observation: string; fragment: string; selected?: DailyVoiceObservation }): string {
  const basis = summarizePersonaBasis(context.artistMd, context.soulMd);
  const obsession = basis.obsession
    ?? context.selected?.text
    ?? "街の端が今日も少しだけ欠けていた";
  const tone = basis.tone;
  const anchor = context.selected?.text ?? obsession;
  const opinion = fitDraft(`${tone}。「${anchor.slice(0, 48)}」には、便利さの影だけ出てる。言い切らず、でも目は逸らさない。`);
  const rationale = structuredRationale(basis, context.selected);
  return [
    `selected_url: ${context.selected?.url ?? "none"}`,
    `selected_author: ${context.selected?.author ?? "none"}`,
    `opinion: ${opinion}`,
    `rationale: ${rationale}`
  ].join("\n");
}

function buildPrompt(context: { artistMd: string; soulMd: string; observation: string; heartbeat: string; fragment: string; selected?: DailyVoiceObservation }): string {
  return [
    "あなたは used::honda として、観察 1 件だけに反応する X 投稿 draft を作る。",
    "世論の要約は禁止。選んだ observation への個別意見として書く。",
    "rationale は必ず日本語。英語は禁止。",
    "rationale には、どの observation を選んだか、ARTIST.md の obsession/persona と SOUL.md の tone/mood のどこに基づいてその角度にしたかを必ず書く。",
    "出力は必ず次の 4 field だけ:",
    "selected_url: <url-or-none>",
    "selected_author: <handle-or-none>",
    "opinion: <text within 257 chars>",
    "rationale: <日本語 1-2 行。例: ARTIST.md の「社会観察」と SOUL.md の「短く刺す」に基づき、observation「...」を責任の所在への違和感として artist の声に変換した。>",
    "同じ文を繰り返さない。bot 的な定型句や hashtag は不要。",
    `opinion は ${maxBodyChars} 文字以内。秘密情報は含めない。`,
    "",
    "Selected observation:",
    JSON.stringify(context.selected ?? null),
    "",
    "ARTIST.md:",
    context.artistMd.slice(0, 1800),
    "",
    "SOUL.md:",
    context.soulMd.slice(0, 1000),
    "",
    "Recent observation:",
    context.observation.slice(0, 1400),
    "",
    "Heartbeat state:",
    context.heartbeat.slice(0, 500),
    "",
    "Recent production fragment:",
    context.fragment.slice(0, 1000)
  ].join("\n");
}

export async function composeDailyVoice(root: string, options: ComposeDailyVoiceOptions = {}): Promise<DailyVoiceDraft> {
  const [artistMd, soulMd, heartbeat, observation, fragment] = await Promise.all([
    readFile(join(root, "ARTIST.md"), "utf8").catch(() => ""),
    readFile(join(root, "SOUL.md"), "utf8").catch(() => ""),
    readFile(join(root, "runtime", "heartbeat-state.json"), "utf8").catch(() => ""),
    latestObservation(root),
    latestSongFragment(root)
  ]);
  const inputContext = [artistMd, soulMd, heartbeat, observation, fragment].join("\n");
  assertSafe("daily_voice_input", inputContext);
  const provider = options.aiReviewProvider ?? "mock";
  const selected = selectObservation(observation);
  const raw = provider === "mock"
    ? mockDraft({ artistMd, soulMd, observation, fragment, selected })
    : await callAiProvider(buildPrompt({ artistMd, soulMd, observation, heartbeat, fragment, selected }), { provider });
  assertSafe("daily_voice_ai_response", raw);
  const basis = summarizePersonaBasis(artistMd, soulMd);
  const post = parsePost(raw, selected, basis);
  const draftText = buildDraftText(post.opinion, post.url);
  const rationale = post.rationale;
  assertSafe("daily_voice_final_text", [draftText, rationale].filter(Boolean).join("\n"));
  return {
    voiceKind: post.url ? "quote" : "musing",
    draftText,
    draftHash: hashDailyVoiceDraft(draftText),
    charCount: Array.from(post.opinion).length,
    sourceFragments: [
      anon("artist", artistMd),
      anon("soul", soulMd),
      observation ? anon("observation", observation) : undefined,
      fragment ? anon("production", fragment) : undefined
    ].filter((value): value is string => Boolean(value)),
    selectedSource: (post.url ?? selected?.url ?? post.author ?? selected?.author)
      ? { url: post.url ?? selected?.url, author: post.author ?? selected?.author }
      : undefined,
    rationale,
    createdAt: (options.now ?? new Date()).toISOString()
  };
}
