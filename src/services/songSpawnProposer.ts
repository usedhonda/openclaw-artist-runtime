import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AiReviewProvider, CommissionBrief, SongState, SpawnProposal } from "../types.js";
import { callAiProvider, isAiNotConfiguredResponse } from "./aiProviderClient.js";
import { composeArtistFallback } from "./artistVoiceComposer.js";
import { listSongStates } from "./artistState.js";
import { readCallbackActionEntries } from "./callbackActionRegistry.js";
import { extractPersonaMotifs } from "./personaMotifExtractor.js";
import { secretLikePattern } from "./personaMigrator.js";
import { readBudgetState } from "./sunoBudgetLedger.js";
import { validateAgainstVoiceContract } from "./voiceContractValidator.js";
import { isVoiceFingerprintReady, parseVoiceFingerprint, type VoiceFingerprintBundle } from "./voiceFingerprintParser.js";

export interface ProposeSpawnOptions {
  aiReviewProvider?: AiReviewProvider;
  now?: Date;
}

function assertSafe(stage: string, value: string): void {
  if (secretLikePattern.test(value)) {
    throw new Error(`song_spawn_secret_like_${stage}`);
  }
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 6);
}

async function latestObservation(root: string): Promise<string> {
  const dir = join(root, "observations");
  const entries = await readdir(dir).catch(() => []);
  const latest = entries.filter((entry) => entry.endsWith(".md")).sort().at(-1);
  return latest ? readFile(join(dir, latest), "utf8").catch(() => "") : "";
}

function hasRestMood(heartbeat: string, soulMd: string): boolean {
  return /(?:\brest\b|\bpause\b|\bsleep\b|休|静養|停止|休む)/i.test(`${heartbeat}\n${soulMd}`);
}

function recentCompletedTooClose(songs: SongState[], now: Date): boolean {
  const latest = songs.find((song) => ["published", "scheduled", "take_selected"].includes(song.status));
  if (!latest) {
    return false;
  }
  return now.getTime() - new Date(latest.updatedAt).getTime() < 6 * 60 * 60 * 1000;
}

function normalizeTheme(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9一-龠ぁ-んァ-ヶー]+/gi, "");
}

function isSimilarTheme(title: string, recentThemes: string[]): boolean {
  const normalized = normalizeTheme(title);
  if (normalized.length < 3) {
    return false;
  }
  return recentThemes.some((theme) => {
    const recent = normalizeTheme(theme);
    if (recent.length < 3) {
      return false;
    }
    return normalized.includes(recent) || recent.includes(normalized);
  });
}

async function recentSpawnThemes(root: string, now: Date): Promise<string[]> {
  const cutoff = now.getTime() - 24 * 60 * 60 * 1000;
  const entries = await readCallbackActionEntries(root).catch(() => []);
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.createdAt < cutoff || !entry.commissionBrief?.title || !entry.action.startsWith("song_spawn_")) {
      continue;
    }
    seen.add(entry.commissionBrief.title);
  }
  return [...seen].slice(-12);
}

function titleFromSeed(seed: string): string {
  const first = seed.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "静かな夜の勘定書";
  return first.replace(/^#+\s*/, "").slice(0, 32) || "静かな夜の勘定書";
}

function buildBrief(context: { observation: string; soulMd: string; budgetRemaining: number; now: Date }): CommissionBrief {
  const seed = context.observation || context.soulMd || "観察が薄い夜に、街の温度だけ残っている。";
  const title = titleFromSeed(seed);
  const songId = `spawn_${shortHash(`${seed}:${context.now.toISOString()}`)}`;
  return {
    songId,
    title,
    brief: seed.slice(0, 280),
    lyricsTheme: seed.split(/\r?\n/).find(Boolean)?.slice(0, 160) ?? title,
    mood: "observational, slight sarcasm, late-night urban pressure",
    tempo: "artist decides",
    styleNotes: "thick bass, restrained drums, unsentimental vocal delivery",
    duration: "artist decides",
    sourceText: "autopilot song spawn",
    createdAt: context.now.toISOString()
  };
}

function buildVoiceContractLines(fingerprint: VoiceFingerprintBundle): string[] {
  const lines: string[] = ["Voice Contract for the `reason` field (highest priority — match this voice or the line will be replaced):"];
  if (fingerprint.producerCallname) {
    lines.push(`- Address producer as "${fingerprint.producerCallname}".`);
  }
  if (fingerprint.firstPerson) {
    lines.push(`- First-person: "${fingerprint.firstPerson}".`);
  }
  if (fingerprint.sentenceEndings.length > 0) {
    lines.push(`- Allowed sentence endings: ${fingerprint.sentenceEndings.slice(0, 6).map((e) => `"${e}"`).join(" / ")}.`);
  }
  if (fingerprint.forbiddenPhrases.length > 0) {
    const sample = fingerprint.forbiddenPhrases.slice(0, 6).map((p) => `"${p}"`).join(", ");
    lines.push(`- Forbidden phrases (NEVER output): ${sample}.`);
  }
  if (fingerprint.signatureMoves.length > 0) {
    lines.push("- Sample voice (the ONLY way to sound):");
    for (const sample of fingerprint.signatureMoves.slice(0, 4)) {
      lines.push(`  · "${sample}"`);
    }
  }
  return lines;
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 3)}...`;
}

function buildPersonaBody(context: { artistMd: string; soulMd: string; identityMd: string; innerMd: string; producerMd: string }): string[] {
  const sections: { name: string; content: string; cap: number }[] = [
    { name: "SOUL.md", content: context.soulMd, cap: 12000 },
    { name: "ARTIST.md", content: context.artistMd, cap: 6000 },
    { name: "IDENTITY.md", content: context.identityMd, cap: 1500 },
    { name: "INNER.md", content: context.innerMd, cap: 4000 },
    { name: "PRODUCER.md", content: context.producerMd, cap: 3000 }
  ];
  const out: string[] = [];
  for (const section of sections) {
    if (!section.content || section.content.trim().length === 0) continue;
    out.push(`===== ${section.name} =====`);
    out.push(truncate(section.content, section.cap));
    out.push("");
  }
  return out;
}

function buildPrompt(context: {
  artistMd: string;
  soulMd: string;
  identityMd: string;
  innerMd: string;
  producerMd: string;
  observation: string;
  heartbeat: string;
  recentSongs: SongState[];
  budgetRemaining: number;
  recentThemes: string[];
  fingerprint: VoiceFingerprintBundle;
}): string {
  const lines: string[] = [
    "System: あなたは used::honda 本人。 producer に新曲を提案する artist として一人称で書く。",
    "Decision: 観察と heartbeat から、 今 新曲を始めるべきか判断する。 不十分なら spawn: no。",
    "Avoid any subject or title already listed in recently proposed themes.",
    "Never include secrets. Keep the brief lean enough for autopilot planning.",
    "",
    "出力 schema (1 行ずつ、 順序固定):",
    "spawn: <yes/no>",
    "title: <artistic title>",
    "brief: <280 chars 以内、 楽曲の中身要約>",
    "lyricsTheme: <一行 theme>",
    "mood: <english spec keywords e.g. 'tense, late-night, urban pressure'>",
    "tempo: <'artist decides' or '142 BPM'>",
    "duration: <'2:45' 等>",
    "style: <english spec keywords>",
    "reason: <**日本語のみ**、 artist 一人称口語、 producer に話しかける 1 行 (e.g. \"" + (context.fingerprint.producerCallname ?? "ゆずる") + "、 〜の街を切るやつ、 刺さる\")>",
    "",
    ...buildVoiceContractLines(context.fingerprint),
    "",
    `Budget remaining: ${context.budgetRemaining}`,
    `Recent songs: ${context.recentSongs.slice(0, 5).map((song) => `${song.songId}:${song.status}:${song.title}`).join(" | ")}`,
    `Recently proposed themes to avoid: ${context.recentThemes.length > 0 ? context.recentThemes.join(" | ") : "none"}`,
    "",
    "Latest observations:",
    context.observation.slice(0, 1200),
    "",
    "Heartbeat:",
    context.heartbeat.slice(0, 500),
    "",
    ...buildPersonaBody(context)
  ];
  return lines.join("\n");
}

function parseDirective(raw: string, key: string): string | undefined {
  const line = raw.split(/\r?\n/).find((candidate) => candidate.toLowerCase().startsWith(`${key.toLowerCase()}:`));
  return line?.slice(line.indexOf(":") + 1).trim();
}

function briefFromAi(raw: string, fallback: CommissionBrief, now: Date): { brief: CommissionBrief; reason: string; spawn: boolean } {
  const spawnValue = parseDirective(raw, "spawn")?.toLowerCase();
  const spawn = !spawnValue || /^(yes|true|1|go|進める|作る)/i.test(spawnValue);
  const title = parseDirective(raw, "title") || fallback.title;
  const brief = parseDirective(raw, "brief") || fallback.brief;
  return {
    spawn,
    reason: parseDirective(raw, "reason") || "AI judged the observations and budget as suitable for a next song.",
    brief: {
      ...fallback,
      title,
      brief,
      lyricsTheme: parseDirective(raw, "lyricsTheme") || parseDirective(raw, "lyrics") || brief,
      mood: parseDirective(raw, "mood") || fallback.mood,
      tempo: parseDirective(raw, "tempo") || fallback.tempo,
      duration: parseDirective(raw, "duration") || fallback.duration,
      styleNotes: parseDirective(raw, "style") || fallback.styleNotes,
      createdAt: now.toISOString()
    }
  };
}

function composeReasonInArtistVoice(args: {
  artistMd: string;
  soulMd: string;
  fingerprint: VoiceFingerprintBundle;
  observation: string;
}): string {
  const motifs = extractPersonaMotifs([args.artistMd, args.soulMd].join("\n"));
  return composeArtistFallback({
    userMessage: args.observation.slice(0, 200),
    motifs,
    userIntent: "propose",
    voiceFingerprint: args.fingerprint,
    lastEndings: []
  });
}

export async function proposeSpawn(root: string, options: ProposeSpawnOptions = {}): Promise<SpawnProposal | null> {
  const now = options.now ?? new Date();
  const [artistMd, soulMd, identityMd, innerMd, producerMd, heartbeat, observation, songs, budget, recentThemes] = await Promise.all([
    readFile(join(root, "ARTIST.md"), "utf8").catch(() => ""),
    readFile(join(root, "SOUL.md"), "utf8").catch(() => ""),
    readFile(join(root, "IDENTITY.md"), "utf8").catch(() => ""),
    readFile(join(root, "INNER.md"), "utf8").catch(() => ""),
    readFile(join(root, "PRODUCER.md"), "utf8").catch(() => ""),
    readFile(join(root, "runtime", "heartbeat-state.json"), "utf8").catch(() => ""),
    latestObservation(root),
    listSongStates(root).catch(() => []),
    readBudgetState(root, now),
    recentSpawnThemes(root, now)
  ]);
  const budgetRemaining = budget.limit - budget.used;
  if (budgetRemaining <= 1 || hasRestMood(heartbeat, soulMd) || recentCompletedTooClose(songs, now) || observation.trim().length < 12) {
    return null;
  }
  const inputContext = [artistMd, soulMd, identityMd, innerMd, producerMd, heartbeat, observation, JSON.stringify(songs.slice(0, 5)), JSON.stringify(budget)].join("\n");
  assertSafe("input", inputContext);

  const fingerprint = parseVoiceFingerprint(soulMd);
  const fallback = buildBrief({ observation, soulMd, budgetRemaining, now });
  const provider = options.aiReviewProvider ?? "mock";
  const mockReason = composeReasonInArtistVoice({ artistMd, soulMd, fingerprint, observation });
  const raw = provider === "mock"
    ? [
      "spawn: yes",
      `title: ${fallback.title}`,
      `brief: ${fallback.brief}`,
      `lyricsTheme: ${fallback.lyricsTheme}`,
      `mood: ${fallback.mood}`,
      `tempo: ${fallback.tempo}`,
      `duration: ${fallback.duration}`,
      `style: ${fallback.styleNotes}`,
      `reason: ${mockReason}`
    ].join("\n")
    : await callAiProvider(buildPrompt({
      artistMd,
      soulMd,
      identityMd,
      innerMd,
      producerMd,
      observation,
      heartbeat,
      recentSongs: songs,
      budgetRemaining,
      recentThemes,
      fingerprint
    }), { provider });
  assertSafe("ai_response", raw);
  const parsed = briefFromAi(isAiNotConfiguredResponse(raw) ? "" : raw, fallback, now);
  if (isSimilarTheme(parsed.brief.title, recentThemes)) {
    return null;
  }
  // Post-validate the reason: if voice fingerprint is ready and AI output violates contract,
  // replace the reason with a deterministic artist-voice line from composeArtistFallback.
  if (isVoiceFingerprintReady(fingerprint).ok) {
    const validation = validateAgainstVoiceContract(parsed.reason, {
      fingerprint,
      lastEndings: []
    });
    if (!validation.ok) {
      parsed.reason = composeReasonInArtistVoice({ artistMd, soulMd, fingerprint, observation });
    }
  }
  const finalText = JSON.stringify(parsed.brief) + parsed.reason;
  assertSafe("final", finalText);
  return parsed.spawn ? {
    spawn: true,
    brief: parsed.brief,
    reason: parsed.reason,
    candidateSongId: parsed.brief.songId
  } : null;
}
