import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { applyConfigDefaults } from "../config/schema.js";
import type { AiReviewProvider, ArtistRuntimeConfig, SocialAssetRecord, SocialPlatform, SongState } from "../types.js";
import { callAiProvider, isPlaceholderAiResponse } from "./aiProviderClient.js";
import { readSongState, updateSongState } from "./artistState.js";
import { buildPrompt, readArtistVoiceContext } from "./artistVoiceResponder.js";
import { appendPromptLedger, createPromptLedgerEntry, getSongPromptLedgerPath } from "./promptLedger.js";
import { validateAgainstVoiceContract } from "./voiceContractValidator.js";
import { isVoiceFingerprintReady, parseVoiceFingerprint } from "./voiceFingerprintParser.js";

export interface PrepareSocialAssetsInput {
  workspaceRoot: string;
  songId: string;
  config?: Partial<ArtistRuntimeConfig>;
}

// X weights CJK characters double toward its 280-character limit, so the body
// stays well under 140 CJK characters and leaves room for the take link.
const X_POST_BODY_MAX_CHARS = 120;
const SUNO_TAKE_URL_PATTERN = /^https:\/\/suno\.com\/song\/[A-Za-z0-9-]+$/;

function captionPath(root: string, songId: string, platform: SocialPlatform): string {
  const suffix = platform === "x" ? "post" : "caption";
  return join(root, "songs", songId, "social", `${platform}-${suffix}.md`);
}

function promptPath(root: string, songId: string, platform: SocialPlatform): string {
  return join(root, "songs", songId, "social", `${platform}-post.prompt.md`);
}

function buildCopy(platform: SocialPlatform, title: string, reason?: string, takeId?: string): string {
  const lead = platform === "x" ? title : `${title}\n`;
  return [
    lead,
    reason ?? "The signal stayed after the room went dark.",
    takeId ? `Source take: ${takeId}` : "Source take: pending selection",
    "Public note: direct, observant, never salesy."
  ].join("\n");
}

function defaultPostType(platform: SocialPlatform): string {
  return platform === "x" ? "observation" : platform === "instagram" ? "lyric_card" : "hook_clip";
}

function fitPostBody(value: string, maxChars: number): string {
  const compact = value
    .replace(/#[\p{L}\p{N}_-]+/gu, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .replace(/^["'「『]+|["'」』]+$/g, "")
    .trim();
  const chars = Array.from(compact);
  if (chars.length <= maxChars) {
    return compact;
  }
  const sliced = chars.slice(0, maxChars - 1).join("");
  const boundary = Math.max(sliced.lastIndexOf("。"), sliced.lastIndexOf("、"), sliced.lastIndexOf("\n"), sliced.lastIndexOf(" "));
  return `${(boundary > Math.floor(maxChars * 0.5) ? sliced.slice(0, boundary) : sliced).trim()}…`;
}

function publicTakeUrl(song: SongState): string | undefined {
  return [...song.publicLinks].reverse().find((link) => SUNO_TAKE_URL_PATTERN.test(link));
}

function buildReleasePostMessage(song: SongState, brief: string, lyricsFragment: string): string {
  return [
    "Producer task: 完成した新曲を X で共有する投稿本文を artist 一人称で書け。",
    "曲を売り込まない。宣伝口調・告知テンプレ・bot 定型句・hashtag は禁止。",
    "その曲を作るきっかけになった観察や、歌詞の中の一つの視点を、artist の口語で 1-3 文に。",
    `${X_POST_BODY_MAX_CHARS} 文字以内。URL は書かない(後で付ける)。内部 file 名・曲 ID・take ID・状態の説明を出さない。`,
    "SOUL.md の sentence_endings と forbidden_phrases を遵守。出力は投稿本文のみ。",
    "",
    `Song title: ${song.title}`,
    "",
    "Brief:",
    brief.slice(0, 900),
    "",
    "Lyrics fragment:",
    lyricsFragment.slice(0, 600)
  ].join("\n");
}

async function readLyricsFragment(root: string, songId: string): Promise<string> {
  const direct = await readFile(join(root, "songs", songId, "lyrics.md"), "utf8").catch(() => "");
  if (direct.trim()) {
    return direct;
  }
  const dir = join(root, "songs", songId, "lyrics");
  const entries = await readdir(dir).catch(() => [] as string[]);
  const latest = entries.filter((entry) => entry.endsWith(".md")).sort().at(-1);
  return latest ? readFile(join(dir, latest), "utf8").catch(() => "") : "";
}

/**
 * Compose the public X post for a finished song in the artist's own voice.
 * Fails closed: a placeholder provider response or a voice-contract violation
 * throws instead of degrading to template text, because this copy is published
 * without a producer button when X is armed.
 */
async function composeXPostCopy(root: string, song: SongState, provider: AiReviewProvider): Promise<{ copy: string; prompt: string }> {
  const [context, brief, lyricsFragment] = await Promise.all([
    readArtistVoiceContext(root, { topic: "song_release_post" }),
    readFile(join(root, "songs", song.songId, "brief.md"), "utf8").catch(() => ""),
    readLyricsFragment(root, song.songId)
  ]);
  const prompt = buildPrompt(buildReleasePostMessage(song, brief, lyricsFragment), context, "report");
  const raw = await callAiProvider(prompt, { provider });
  if (isPlaceholderAiResponse(raw)) {
    throw new Error("social_copy_ai_unavailable");
  }
  const fingerprint = parseVoiceFingerprint(context.soulMd ?? "");
  if (isVoiceFingerprintReady(fingerprint).ok) {
    const validation = validateAgainstVoiceContract(raw, { fingerprint, lastEndings: context.lastEndings ?? [] });
    if (!validation.ok) {
      throw new Error(`social_copy_voice_contract: ${validation.violations.map((violation) => violation.detail).join("; ")}`);
    }
  }
  const body = fitPostBody(raw, X_POST_BODY_MAX_CHARS);
  if (!body) {
    throw new Error("social_copy_empty");
  }
  const url = publicTakeUrl(song);
  return { copy: url ? `${body}\n\n${url}` : body, prompt };
}

export async function prepareSocialAssets(input: PrepareSocialAssetsInput): Promise<SocialAssetRecord[]> {
  const config = applyConfigDefaults(input.config);
  if (config.distribution.dailySharing === "off") {
    throw new Error("daily_sharing_off");
  }
  const song = await readSongState(input.workspaceRoot, input.songId);
  if (!song.selectedTakeId) {
    throw new Error(`cannot prepare social assets before take selection for ${input.songId}`);
  }

  const enabledPlatforms = (Object.entries(config.distribution.platforms) as Array<[SocialPlatform, ArtistRuntimeConfig["distribution"]["platforms"][SocialPlatform]]>)
    .filter(([, platform]) => platform.enabled)
    .map(([platform]) => platform);
  const targets = (enabledPlatforms.length > 0 ? enabledPlatforms : (["x"] as SocialPlatform[]))
    .filter((platform) => config.distribution.platforms[platform].autoPostTypes.includes(defaultPostType(platform)));
  if (targets.length === 0) {
    throw new Error("no_enabled_auto_post_types");
  }

  const records: SocialAssetRecord[] = [];
  const promptRefs: string[] = [];
  await mkdir(join(input.workspaceRoot, "songs", input.songId, "social"), { recursive: true });
  for (const platform of targets) {
    const textPath = captionPath(input.workspaceRoot, input.songId, platform);
    let copy: string;
    if (platform === "x" && config.aiReview.provider !== "mock") {
      const composed = await composeXPostCopy(input.workspaceRoot, song, config.aiReview.provider);
      copy = composed.copy;
      const promptRef = promptPath(input.workspaceRoot, input.songId, platform);
      await writeFile(promptRef, `${composed.prompt}\n`, "utf8");
      promptRefs.push(promptRef);
    } else {
      copy = buildCopy(platform, song.title, song.lastReason, song.selectedTakeId);
    }
    await writeFile(textPath, `${copy}\n`, "utf8");
    records.push({
      songId: input.songId,
      platform,
      postType: defaultPostType(platform),
      textPath,
      mediaRefs: [],
      sourceTakeId: song.selectedTakeId
    });
  }

  await writeFile(
    join(input.workspaceRoot, "songs", input.songId, "social", "assets.json"),
    `${JSON.stringify(records, null, 2)}\n`,
    "utf8"
  );
  await appendPromptLedger(
    getSongPromptLedgerPath(input.workspaceRoot, input.songId),
    createPromptLedgerEntry({
      stage: "social_asset_prepare",
      songId: input.songId,
      actor: "artist",
      inputRefs: [join(input.workspaceRoot, "songs", input.songId, "suno", "selected-take.json"), ...promptRefs],
      outputRefs: records.map((record) => record.textPath),
      outputSummary: records.map((record) => `${record.platform}:${record.postType}`).join(", ")
    })
  );
  await updateSongState(input.workspaceRoot, input.songId, {
    status: "social_assets",
    reason: "social assets prepared"
  });

  return records;
}
