import { secretLikePattern } from "./personaMigrator.js";

export interface SunoTakeScore {
  takeId: string;
  url: string;
  lyricsScore: number;
  sonicMatch: number;
  moodAlignment: number;
  total: number;
  reason: string;
}

function takeId(url: string, index: number): string {
  return url.split("/").filter(Boolean).at(-1)?.replace(/[^a-zA-Z0-9_-]/g, "-") || `take-${index + 1}`;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function axisScore(text: string, url: string, hints: string[]): number {
  const haystack = `${text}\n${url}`.toLowerCase();
  const hits = hints.filter((hint) => haystack.includes(hint)).length;
  return clamp(0.66 + hits * 0.08 - (/(bad|noise|broken|low)/i.test(url) ? 0.45 : 0));
}

export function scoreSunoTakes(input: { urls: string[]; briefText?: string; lyricsText?: string }): SunoTakeScore[] {
  const source = `${input.urls.join("\n")}\n${input.briefText ?? ""}\n${input.lyricsText ?? ""}`;
  if (secretLikePattern.test(source)) {
    throw new Error("suno_take_score_secret_like_input");
  }
  return input.urls.map((url, index) => {
    const lyricsScore = axisScore(input.lyricsText ?? "", url, ["hook", "verse", "chorus", "lyrics"]);
    const sonicMatch = axisScore(input.briefText ?? "", url, ["bass", "drum", "synth", "guitar", "piano"]);
    const moodAlignment = axisScore(input.briefText ?? "", url, ["mood", "cold", "warm", "dark", "bright"]);
    const total = Number(((lyricsScore * 0.35) + (sonicMatch * 0.35) + (moodAlignment * 0.3)).toFixed(3));
    return {
      takeId: takeId(url, index),
      url,
      lyricsScore,
      sonicMatch,
      moodAlignment,
      total,
      reason: `lyrics=${lyricsScore.toFixed(2)} sonic=${sonicMatch.toFixed(2)} mood=${moodAlignment.toFixed(2)}`
    };
  });
}
