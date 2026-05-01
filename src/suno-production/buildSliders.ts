import type { SunoSliders } from "../types.js";

export interface BuildSlidersInput {
  genre?: string;
  moodHint?: string;
}

const presets: Record<string, SunoSliders> = {
  rap: { weirdness: 40, styleInfluence: 75, audioInfluence: 25 },
  jazz: { weirdness: 30, styleInfluence: 65, audioInfluence: 30 },
  edm: { weirdness: 50, styleInfluence: 80, audioInfluence: 20 },
  pop: { weirdness: 35, styleInfluence: 70, audioInfluence: 25 },
  rock: { weirdness: 38, styleInfluence: 72, audioInfluence: 25 }
};

function clamp(value: number): number {
  return Math.min(85, Math.max(15, Math.round(value)));
}

function presetFor(genre = ""): SunoSliders {
  const lower = genre.toLowerCase();
  if (/rap|hip.?hop/.test(lower)) return presets.rap;
  if (/jazz/.test(lower)) return presets.jazz;
  if (/edm|dance|club/.test(lower)) return presets.edm;
  if (/rock|punk/.test(lower)) return presets.rock;
  return presets.pop;
}

export function buildSliders(input: BuildSlidersInput = {}): SunoSliders {
  const base = presetFor(input.genre);
  const mood = (input.moodHint ?? "").toLowerCase();
  const weirdShift = /strange|surreal|unease|dread|noisy|glitch/.test(mood) ? 10 : /plain|soft|clean|warm/.test(mood) ? -5 : 0;
  const styleShift = /precise|tight|genre|classic/.test(mood) ? 5 : /loose|raw|fragment/.test(mood) ? -5 : 0;
  const audioShift = /reference|sample|audio/.test(mood) ? 10 : /original|new/.test(mood) ? -5 : 0;
  return {
    weirdness: clamp(base.weirdness + weirdShift),
    styleInfluence: clamp(base.styleInfluence + styleShift),
    audioInfluence: clamp(base.audioInfluence + audioShift)
  };
}
