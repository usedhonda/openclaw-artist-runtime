import { createHash } from "node:crypto";
import type { SongState, AiReviewProvider } from "../types.js";
import type { CallbackActionEntry } from "./callbackActionRegistry.js";
import { generateArtistResponse, readArtistVoiceContext, type ArtistVoiceContext, type ArtistVoiceResponse } from "./artistVoiceResponder.js";
import { birdWhoami, combinedBirdOutput, parseTweetUrl as parseBirdTweetUrl, runBirdCommand, type SpawnImpl } from "./birdRunner.js";
import { secretLikePattern } from "./personaMigrator.js";

export type XPublishAction = "x_publish_prepare" | "x_publish_confirm" | "x_publish_cancel" | "daily_voice_publish";
export type XPublishStatus = "prepared" | "published" | "cancelled" | "failed";

export interface XPostDraft {
  draftText: string;
  draftHash: string;
  draftCharCount: number;
  draftUrl?: string;
}

export interface XPublishActionResult {
  action: XPublishAction;
  status: XPublishStatus;
  reason?: string;
  draft?: XPostDraft;
  tweetUrl?: string;
  birdStatus?: string;
}

export interface XPublishActionInput {
  root: string;
  songId: string;
  action: XPublishAction;
  actor?: string;
  songState?: SongState;
  sunoUrl?: string;
  entry?: Pick<CallbackActionEntry, "draftText" | "draftHash" | "draftUrl">;
  finalText?: string;
  aiReviewProvider?: AiReviewProvider;
  spawnImpl?: SpawnImpl;
  generateResponse?: (message: string) => Promise<ArtistVoiceResponse>;
  timeoutMs?: number;
}

const tcoUrlLength = 23;
const maxTweetLength = 280;
const defaultTimeoutMs = 10_000;

export { parseTweetUrl } from "./birdRunner.js";

export function assertNotWatchdogActor(actor?: string): void {
  if (actor === "watchdog_recovery" || actor === "watchdog_reprompt" || actor === "watchdog_expire") {
    throw new Error("external_publish_actor_guard");
  }
}

export function normalizeXPostText(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

export function hashXPostText(value: string): string {
  return createHash("sha256").update(normalizeXPostText(value)).digest("hex");
}

function assertNoSecret(label: string, value: string): void {
  if (secretLikePattern.test(value)) {
    throw new Error(`${label}_contains_secret_like_text`);
  }
}

function firstUrl(values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const match = value?.match(/https?:\/\/\S+/i)?.[0];
    if (match) {
      return match.replace(/[),.。]+$/, "");
    }
  }
  return undefined;
}

function stripUrls(value: string): string {
  return value.replace(/https?:\/\/\S+/gi, "").replace(/[ \t]{2,}/g, " ").trim();
}

export function effectiveTweetLength(text: string, url?: string): number {
  return Array.from(stripUrls(text)).length + (url ? tcoUrlLength + 1 : 0);
}

function truncateToBudget(value: string, budget: number): string {
  const chars = Array.from(value);
  if (chars.length <= budget) {
    return value;
  }
  const room = Math.max(0, budget - 3);
  const sliced = chars.slice(0, room).join("");
  const boundary = Math.max(
    sliced.lastIndexOf("。"),
    sliced.lastIndexOf("、"),
    sliced.lastIndexOf("."),
    sliced.lastIndexOf("!"),
    sliced.lastIndexOf("?"),
    sliced.lastIndexOf(" ")
  );
  const base = boundary >= Math.floor(room * 0.55) ? sliced.slice(0, boundary).trim() : sliced.trim();
  return `${base}...`;
}

export function fitXPostText(rawText: string, url?: string): string {
  const body = stripUrls(normalizeXPostText(rawText)).replace(/\n{3,}/g, "\n\n");
  const budget = maxTweetLength - (url ? tcoUrlLength + 1 : 0);
  const fitted = truncateToBudget(body, budget);
  return normalizeXPostText(url ? `${fitted}\n${url}` : fitted);
}

function draftPrompt(songState: SongState, url?: string): string {
  return [
    "Write one X post as the artist. No private data or unsupported claims.",
    "Keep body under 240 chars before URL.",
    `Song: ${songState.title} (${songState.songId}, ${songState.status})`,
    songState.selectedTakeId ? `Take: ${songState.selectedTakeId}` : undefined,
    songState.lastReason ? `Why: ${songState.lastReason}` : undefined,
    url ? `URL: ${url}` : undefined
  ].filter(Boolean).join("\n");
}

function redactSecretLikeLines(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => secretLikePattern.test(line) ? "[redacted private context line]" : line)
    .join("\n");
}

function safeArtistVoiceContext(context: ArtistVoiceContext): ArtistVoiceContext {
  return {
    ...context,
    artistMd: redactSecretLikeLines(context.artistMd),
    soulMd: redactSecretLikeLines(context.soulMd),
    currentState: redactSecretLikeLines(context.currentState),
    socialVoice: redactSecretLikeLines(context.socialVoice),
    recentHistory: context.recentHistory.map(redactSecretLikeLines)
  };
}

export async function buildXPostDraft(input: {
  root: string;
  songState: SongState;
  sunoUrl?: string;
  aiReviewProvider?: AiReviewProvider;
  generateResponse?: (message: string) => Promise<ArtistVoiceResponse>;
}): Promise<XPostDraft> {
  const url = firstUrl([input.sunoUrl, ...input.songState.publicLinks]);
  const contextText = `${input.songState.title}\n${input.songState.lastReason ?? ""}\n${url ?? ""}`;
  assertNoSecret("x_publish_input", contextText);
  const message = draftPrompt(input.songState, url);
  const response = input.generateResponse
    ? await input.generateResponse(message)
    : await generateArtistResponse(message, safeArtistVoiceContext(await readArtistVoiceContext(input.root, { topic: "x_publish_draft" })), {
        intent: "report",
        aiReviewProvider: input.aiReviewProvider
      });
  assertNoSecret("x_publish_ai_response", response.text);
  const draftText = fitXPostText(response.text, url);
  assertNoSecret("x_publish_final_text", draftText);
  return {
    draftText,
    draftHash: hashXPostText(draftText),
    draftCharCount: effectiveTweetLength(draftText, url),
    draftUrl: url
  };
}

async function publishWithBird(action: XPublishAction, text: string, spawnImpl: SpawnImpl | undefined, timeoutMs: number): Promise<XPublishActionResult> {
  const auth = await birdWhoami({ spawnImpl, timeoutMs });
  if (!auth.authed) {
    return { action, status: "failed", reason: auth.error ?? "bird_publish_failed", birdStatus: "auth_failed" };
  }
  const posted = await runBirdCommand(["--plain", "tweet", text], { spawnImpl, timeoutMs });
  if (posted.status !== "success") {
    return {
      action,
      status: "failed",
      reason: posted.error === "bird_command_failed" ? "bird_publish_failed" : posted.error,
      birdStatus: "tweet_failed"
    };
  }
  const tweetUrl = parseBirdTweetUrl(combinedBirdOutput(posted));
  if (!tweetUrl) {
    return { action, status: "failed", reason: "bird_publish_missing_tweet_url", birdStatus: "tweet_missing_url" };
  }
  return { action, status: "published", tweetUrl, birdStatus: "tweet_posted" };
}

export async function executeXPublishAction(input: XPublishActionInput): Promise<XPublishActionResult> {
  assertNotWatchdogActor(input.actor);
  if (input.action === "x_publish_cancel") {
    return { action: input.action, status: "cancelled" };
  }
  if (input.action === "x_publish_prepare") {
    if (!input.songState) {
      return { action: input.action, status: "failed", reason: "missing_song_state" };
    }
    const draft = await buildXPostDraft({
      root: input.root,
      songState: input.songState,
      sunoUrl: input.sunoUrl,
      aiReviewProvider: input.aiReviewProvider,
      generateResponse: input.generateResponse
    });
    return { action: input.action, status: "prepared", draft };
  }

  const finalText = normalizeXPostText(input.finalText ?? input.entry?.draftText ?? "");
  if (!finalText) {
    return { action: input.action, status: "failed", reason: "missing_x_publish_draft" };
  }
  assertNoSecret("x_publish_final_text", finalText);
  const expectedHash = input.entry?.draftHash;
  if (expectedHash && hashXPostText(finalText) !== expectedHash) {
    return { action: input.action, status: "failed", reason: "x_publish_hash_mismatch" };
  }
  return publishWithBird(input.action, finalText, input.spawnImpl, input.timeoutMs ?? defaultTimeoutMs);
}
