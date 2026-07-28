export interface DurationPlanSection {
  key: string;
  label: string;
  bars: number;
  // Minimum lines this section contributes to the bare-lyrics line floor.
  // The sum across sections is the plan's enforced line floor (see
  // minimumBareLyricsLines), so each template carries its own coherent floor.
  lineFloor: number;
  lineTarget: string;
  modifier: string;
  lyricInstruction: string;
  repeatOf?: string;
  finalPayoff?: boolean;
}

export type TempoBand = "slow" | "mid" | "up" | "dopagaki";

export const TEMPO_BANDS: readonly TempoBand[] = ["slow", "mid", "up", "dopagaki"];

export interface DurationPlan {
  version: "duration_plan_v1";
  templateId: string;
  tempoBand: TempoBand;
  targetSeconds: number;
  minSeconds: number;
  maxSeconds: number;
  acceptableMinSeconds: number;
  acceptableMaxSeconds: number;
  bpm: {
    target: number;
    min: number;
    max: number;
    noDoubleTimeVocal: boolean;
  };
  form: string;
  totalPlannedBars: number;
  chorusPolicy: {
    physicalRepeats: number;
    finalChorusMode: string;
  };
  sectionPlan: DurationPlanSection[];
}

// Shared across every band: same 10-section skeleton, same hook-repeat contract,
// same target duration window. Only the per-band tempo and the per-section bar /
// line density change, so the validator and YAML form string stay band-invariant
// while faster bands legitimately carry more bars (and denser lyric floors).
const SHARED_FORM = "intro-v1-prehook-hook-v2-prehook-hook-bridge-finalhook-outro";
const SHARED_TARGET_SECONDS = 195;
const SHARED_MIN_SECONDS = 180;
const SHARED_MAX_SECONDS = 210;
const SHARED_ACCEPTABLE_MIN_SECONDS = 150;
const SHARED_ACCEPTABLE_MAX_SECONDS = 240;
const SHARED_CHORUS_POLICY = {
  physicalRepeats: 3,
  finalChorusMode: "same hook physically repeated plus one payoff line"
};

function mk(
  key: string,
  label: string,
  bars: number,
  lineFloor: number,
  lineTarget: string,
  modifier: string,
  lyricInstruction: string,
  extra?: { repeatOf?: string; finalPayoff?: boolean }
): DurationPlanSection {
  return { key, label, bars, lineFloor, lineTarget, modifier, lyricInstruction, ...extra };
}

const MID_PLAN: DurationPlan = {
  version: "duration_plan_v1",
  templateId: "default_nu_jazz_rap_full_v1",
  tempoBand: "mid",
  targetSeconds: SHARED_TARGET_SECONDS,
  minSeconds: SHARED_MIN_SECONDS,
  maxSeconds: SHARED_MAX_SECONDS,
  acceptableMinSeconds: SHARED_ACCEPTABLE_MIN_SECONDS,
  acceptableMaxSeconds: SHARED_ACCEPTABLE_MAX_SECONDS,
  bpm: {
    target: 108,
    min: 96,
    max: 118,
    noDoubleTimeVocal: true
  },
  form: SHARED_FORM,
  totalPlannedBars: 80,
  chorusPolicy: SHARED_CHORUS_POLICY,
  sectionPlan: [
    mk("intro", "Intro", 4, 1, "0-1 line", "4 bars, sparse scene, no rush",
      "0-1 line; establish the scene and do not start rushing."),
    mk("verse1", "Verse 1", 16, 14, "14-16 lines", "16 bars, dense rap phrasing, internal rhymes, no double-time",
      "14-16 lines; aim for about one line per bar with dense rap phrasing, internal rhymes, and no double-time delivery."),
    mk("prehook1", "Pre-Hook", 4, 3, "3-4 lines", "4 bars, rising tension, tight turn",
      "3-4 lines; lift tension into the hook with a tight turn."),
    mk("hook1", "Hook", 8, 4, "4 lines", "8 bars, full hook, repeat melody, no double-time",
      "4 lines; full hook with a repeatable phrase."),
    mk("verse2", "Verse 2", 16, 14, "14-16 lines", "16 bars, dense rap phrasing, internal rhymes, no double-time",
      "14-16 lines; extend the image from Verse 1 with about one line per bar and controlled syllable density."),
    mk("prehook2", "Pre-Hook 2", 4, 3, "3-4 lines", "4 bars, rising tension, answer verse",
      "3-4 lines; answer Verse 2 and rise into the repeated hook."),
    mk("hook2", "Hook 2", 8, 4, "4 lines", "8 bars, full hook, repeat same text",
      "Repeat the Hook text physically, not just an instruction to repeat.", { repeatOf: "hook1" }),
    mk("bridge", "Bridge", 8, 4, "4-6 lines", "8 bars, reduced drums, perspective shift",
      "4-6 lines; reduce drums, change viewpoint, and set up the final hook."),
    mk("finalhook", "Final Hook", 8, 4, "4-5 lines", "8 bars, full final hook, payoff line",
      "Repeat the Hook text again and add one payoff line that resolves the image.", { repeatOf: "hook1", finalPayoff: true }),
    mk("outro", "Outro", 4, 1, "0-1 line", "4 bars, resolved landing, clean stop",
      "0-1 line; land cleanly and do not open a new idea.")
  ]
};

// slow: dropped, late-night observation. ~92 BPM, sparser lines, 70 bars.
const SLOW_PLAN: DurationPlan = {
  version: "duration_plan_v1",
  templateId: "slow_nu_jazz_rap_v1",
  tempoBand: "slow",
  targetSeconds: SHARED_TARGET_SECONDS,
  minSeconds: SHARED_MIN_SECONDS,
  maxSeconds: SHARED_MAX_SECONDS,
  acceptableMinSeconds: SHARED_ACCEPTABLE_MIN_SECONDS,
  acceptableMaxSeconds: SHARED_ACCEPTABLE_MAX_SECONDS,
  bpm: {
    target: 92,
    min: 84,
    max: 100,
    noDoubleTimeVocal: true
  },
  form: SHARED_FORM,
  totalPlannedBars: 70,
  chorusPolicy: SHARED_CHORUS_POLICY,
  sectionPlan: [
    mk("intro", "Intro", 4, 1, "0-1 line", "4 bars, sparse scene, room to breathe",
      "0-1 line; establish the dropped night scene with space around it."),
    mk("verse1", "Verse 1", 12, 10, "10-12 lines", "12 bars, spacious phrasing, let images land, no double-time",
      "10-12 lines; leave breath between images and keep the delivery unhurried."),
    mk("prehook1", "Pre-Hook", 4, 3, "3-4 lines", "4 bars, slow lift, tight turn",
      "3-4 lines; lift tension gently into the hook."),
    mk("hook1", "Hook", 8, 4, "4 lines", "8 bars, full hook, repeat melody, no double-time",
      "4 lines; full hook with a repeatable phrase."),
    mk("verse2", "Verse 2", 12, 10, "10-12 lines", "12 bars, spacious phrasing, deepen the image, no double-time",
      "10-12 lines; deepen the Verse 1 image with unhurried phrasing."),
    mk("prehook2", "Pre-Hook 2", 4, 3, "3-4 lines", "4 bars, slow lift, answer verse",
      "3-4 lines; answer Verse 2 and rise into the repeated hook."),
    mk("hook2", "Hook 2", 8, 4, "4 lines", "8 bars, full hook, repeat same text",
      "Repeat the Hook text physically, not just an instruction to repeat.", { repeatOf: "hook1" }),
    mk("bridge", "Bridge", 6, 3, "3-5 lines", "6 bars, reduced drums, perspective shift",
      "3-5 lines; reduce drums, change viewpoint, and set up the final hook."),
    mk("finalhook", "Final Hook", 8, 4, "4-5 lines", "8 bars, full final hook, payoff line",
      "Repeat the Hook text again and add one payoff line that resolves the image.", { repeatOf: "hook1", finalPayoff: true }),
    mk("outro", "Outro", 4, 1, "0-1 line", "4 bars, resolved landing, clean stop",
      "0-1 line; land cleanly and do not open a new idea.")
  ]
};

// up: driving urban energy. ~126 BPM, more bars/lines, 92 bars.
const UP_PLAN: DurationPlan = {
  version: "duration_plan_v1",
  templateId: "up_tempo_rap_v1",
  tempoBand: "up",
  targetSeconds: SHARED_TARGET_SECONDS,
  minSeconds: SHARED_MIN_SECONDS,
  maxSeconds: SHARED_MAX_SECONDS,
  acceptableMinSeconds: SHARED_ACCEPTABLE_MIN_SECONDS,
  acceptableMaxSeconds: SHARED_ACCEPTABLE_MAX_SECONDS,
  bpm: {
    target: 126,
    min: 118,
    max: 136,
    noDoubleTimeVocal: true
  },
  form: SHARED_FORM,
  totalPlannedBars: 92,
  chorusPolicy: SHARED_CHORUS_POLICY,
  sectionPlan: [
    mk("intro", "Intro", 4, 1, "0-1 line", "4 bars, sparse scene, no rush",
      "0-1 line; establish the scene and do not start rushing."),
    mk("verse1", "Verse 1", 22, 18, "18-22 lines", "22 bars, driving rap phrasing, internal rhymes, no double-time",
      "18-22 lines; keep about one line per bar with driving phrasing and internal rhymes."),
    mk("prehook1", "Pre-Hook", 4, 3, "3-4 lines", "4 bars, rising tension, tight turn",
      "3-4 lines; lift tension into the hook with a tight turn."),
    mk("hook1", "Hook", 8, 4, "4 lines", "8 bars, full hook, repeat melody, no double-time",
      "4 lines; full hook with a repeatable phrase."),
    mk("verse2", "Verse 2", 22, 18, "18-22 lines", "22 bars, driving rap phrasing, internal rhymes, no double-time",
      "18-22 lines; extend the image from Verse 1 with driving phrasing and controlled density."),
    mk("prehook2", "Pre-Hook 2", 4, 3, "3-4 lines", "4 bars, rising tension, answer verse",
      "3-4 lines; answer Verse 2 and rise into the repeated hook."),
    mk("hook2", "Hook 2", 8, 4, "4 lines", "8 bars, full hook, repeat same text",
      "Repeat the Hook text physically, not just an instruction to repeat.", { repeatOf: "hook1" }),
    mk("bridge", "Bridge", 8, 4, "4-6 lines", "8 bars, reduced drums, perspective shift",
      "4-6 lines; reduce drums, change viewpoint, and set up the final hook."),
    mk("finalhook", "Final Hook", 8, 4, "4-5 lines", "8 bars, full final hook, payoff line",
      "Repeat the Hook text again and add one payoff line that resolves the image.", { repeatOf: "hook1", finalPayoff: true }),
    mk("outro", "Outro", 4, 1, "0-1 line", "4 bars, resolved landing, clean stop",
      "0-1 line; land cleanly and do not open a new idea.")
  ]
};

// dopagaki: high-speed dense rap variation. ~148 BPM, packed verses, 110 bars,
// double-time bursts allowed on the densest bars.
const DOPAGAKI_PLAN: DurationPlan = {
  version: "duration_plan_v1",
  templateId: "dopagaki_fast_rap_v1",
  tempoBand: "dopagaki",
  targetSeconds: SHARED_TARGET_SECONDS,
  minSeconds: SHARED_MIN_SECONDS,
  maxSeconds: SHARED_MAX_SECONDS,
  acceptableMinSeconds: SHARED_ACCEPTABLE_MIN_SECONDS,
  acceptableMaxSeconds: SHARED_ACCEPTABLE_MAX_SECONDS,
  bpm: {
    target: 148,
    min: 138,
    max: 160,
    noDoubleTimeVocal: false
  },
  form: SHARED_FORM,
  totalPlannedBars: 110,
  chorusPolicy: SHARED_CHORUS_POLICY,
  sectionPlan: [
    mk("intro", "Intro", 4, 1, "0-1 line", "4 bars, sharp scene set, instant pressure",
      "0-1 line; slam the scene down fast and set high stimulus immediately."),
    mk("verse1", "Verse 1", 30, 20, "20-21 lines", "30 bars, packed rap phrasing, internal rhymes, double-time bursts allowed",
      "20-21 lines; pack the bars with dense internal rhymes; controlled double-time bursts are allowed on the densest bars."),
    mk("prehook1", "Pre-Hook", 4, 3, "3-4 lines", "4 bars, hard rising tension, tight turn",
      "3-4 lines; snap tension up into the hook with a tight turn."),
    mk("hook1", "Hook", 8, 4, "4 lines", "8 bars, full hook, clipped chant, repeatable",
      "4 lines; full hook with a clipped, chantable, repeatable phrase."),
    mk("verse2", "Verse 2", 30, 20, "20-21 lines", "30 bars, packed rap phrasing, internal rhymes, double-time bursts allowed",
      "20-21 lines; extend the image with packed phrasing; controlled double-time bursts allowed on the densest bars."),
    mk("prehook2", "Pre-Hook 2", 4, 3, "3-4 lines", "4 bars, hard rising tension, answer verse",
      "3-4 lines; answer Verse 2 and snap into the repeated hook."),
    mk("hook2", "Hook 2", 8, 4, "4 lines", "8 bars, full hook, repeat same text",
      "Repeat the Hook text physically, not just an instruction to repeat.", { repeatOf: "hook1" }),
    mk("bridge", "Bridge", 8, 3, "3-5 lines", "8 bars, drop density, perspective shift",
      "3-5 lines; drop the density, change viewpoint, and reload for the final hook."),
    mk("finalhook", "Final Hook", 10, 5, "5-6 lines", "10 bars, full final hook, payoff line",
      "Repeat the Hook text again and add one payoff line that resolves the image.", { repeatOf: "hook1", finalPayoff: true }),
    mk("outro", "Outro", 4, 1, "0-1 line", "4 bars, hard stop landing, clean cut",
      "0-1 line; cut clean and do not open a new idea.")
  ]
};

const PLANS_BY_BAND: Record<TempoBand, DurationPlan> = {
  slow: SLOW_PLAN,
  mid: MID_PLAN,
  up: UP_PLAN,
  dopagaki: DOPAGAKI_PLAN
};

export function getDurationPlan(band: TempoBand = "mid"): DurationPlan {
  return PLANS_BY_BAND[band] ?? MID_PLAN;
}

export function getDurationPlanByTemplateId(templateId: string | undefined): DurationPlan {
  if (!templateId) return MID_PLAN;
  return TEMPO_BANDS.map((band) => PLANS_BY_BAND[band]).find((plan) => plan.templateId === templateId) ?? MID_PLAN;
}

// Reads the artist-chosen tempo band from a brief (or any text carrying the
// "Tempo band: <band>" marker). Returns undefined when no band is declared so
// callers can fall back to the default mid template.
export function resolveTempoBand(source: string | undefined): TempoBand | undefined {
  if (!source) return undefined;
  const match = source.match(/tempo\s*band\s*:\s*(slow|mid|up|dopagaki)\b/i);
  const band = match?.[1]?.toLowerCase() as TempoBand | undefined;
  return band && TEMPO_BANDS.includes(band) ? band : undefined;
}

export function minimumBareLyricsChars(plan: DurationPlan = getDurationPlan()): number {
  return Math.round(plan.totalPlannedBars * 15);
}

export function minimumBareLyricsLines(plan: DurationPlan = getDurationPlan()): number {
  return plan.sectionPlan.reduce((sum, section) => sum + section.lineFloor, 0);
}

function normalizeSectionLabel(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, "");
}

export function findDurationPlanSection(label: string, plan: DurationPlan = getDurationPlan()): DurationPlanSection | undefined {
  const normalized = normalizeSectionLabel(label);
  return plan.sectionPlan.find((section) => normalizeSectionLabel(section.label) === normalized);
}

export function formatDurationPlanForPrompt(plan: DurationPlan = getDurationPlan()): string {
  return [
    `DurationPlan ${plan.version}/${plan.templateId} (tempo band: ${plan.tempoBand}): target ${plan.targetSeconds}s (${plan.minSeconds}-${plan.maxSeconds}s), acceptable ${plan.acceptableMinSeconds}-${plan.acceptableMaxSeconds}s.`,
    `Tempo: ${plan.bpm.target} BPM, allowed ${plan.bpm.min}-${plan.bpm.max} BPM, no double-time vocal: ${plan.bpm.noDoubleTimeVocal ? "yes" : "no"}.`,
    `Form SoT: ${plan.form}; planned bars: ${plan.totalPlannedBars}.`,
    `Chorus policy: physically repeat the hook ${plan.chorusPolicy.physicalRepeats} times; final hook mode: ${plan.chorusPolicy.finalChorusMode}.`,
    "Section plan:",
    ...plan.sectionPlan.map((section) => `- [${section.label} - ${section.modifier}]: ${section.bars} bars, ${section.lineTarget}. ${section.lyricInstruction}`)
  ].join("\n");
}

export function durationPlanCues(plan: DurationPlan = getDurationPlan()): string[] {
  return plan.sectionPlan.map((section) => `${section.label}: ${section.bars} bars, ${section.modifier}`);
}

export function durationPlanProductionNotes(plan: DurationPlan = getDurationPlan()): string[] {
  const pacingNote = plan.bpm.noDoubleTimeVocal
    ? `keep vocal pacing dense but controlled at ${plan.bpm.target} BPM and avoid double-time delivery`
    : `keep vocal pacing fast and dense at ${plan.bpm.target} BPM; allow controlled double-time bursts on the densest bars`;
  return [
    `target ${plan.targetSeconds}s with ${plan.totalPlannedBars} planned bars; preserve the full section map`,
    pacingNote,
    "let pre-hooks lift into full hooks, then drop energy in the bridge before the final hook",
    "repeat the hook text physically in Hook 2 and Final Hook so Suno hears the form"
  ];
}
