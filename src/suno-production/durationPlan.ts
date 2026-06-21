export interface DurationPlanSection {
  key: string;
  label: string;
  bars: number;
  lineTarget: string;
  modifier: string;
  lyricInstruction: string;
  repeatOf?: string;
  finalPayoff?: boolean;
}

export interface DurationPlan {
  version: "duration_plan_v1";
  templateId: "used_honda_nu_jazz_rap_full_v1";
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

export const DEFAULT_USED_HONDA_DURATION_PLAN: DurationPlan = {
  version: "duration_plan_v1",
  templateId: "used_honda_nu_jazz_rap_full_v1",
  targetSeconds: 195,
  minSeconds: 180,
  maxSeconds: 210,
  acceptableMinSeconds: 150,
  acceptableMaxSeconds: 240,
  bpm: {
    target: 108,
    min: 96,
    max: 118,
    noDoubleTimeVocal: true
  },
  form: "intro-v1-prehook-hook-v2-prehook-hook-bridge-finalhook-outro",
  totalPlannedBars: 80,
  chorusPolicy: {
    physicalRepeats: 3,
    finalChorusMode: "same hook physically repeated plus one payoff line"
  },
  sectionPlan: [
    {
      key: "intro",
      label: "Intro",
      bars: 4,
      lineTarget: "0-1 line",
      modifier: "4 bars, sparse scene, no rush",
      lyricInstruction: "0-1 line; establish the scene and do not start rushing."
    },
    {
      key: "verse1",
      label: "Verse 1",
      bars: 16,
      lineTarget: "8 lines",
      modifier: "16 bars, spacious rap phrasing, no double-time",
      lyricInstruction: "8 lines; observational setup with roomy phrasing and no double-time delivery."
    },
    {
      key: "prehook1",
      label: "Pre-Hook",
      bars: 4,
      lineTarget: "2 lines",
      modifier: "4 bars, rising tension, leave breath",
      lyricInstruction: "2 lines; lift tension into the hook and leave breathing room."
    },
    {
      key: "hook1",
      label: "Hook",
      bars: 8,
      lineTarget: "4 lines",
      modifier: "8 bars, full hook, repeat melody, no double-time",
      lyricInstruction: "4 lines; full hook with a repeatable phrase."
    },
    {
      key: "verse2",
      label: "Verse 2",
      bars: 16,
      lineTarget: "8 lines",
      modifier: "16 bars, spacious rap phrasing, no double-time",
      lyricInstruction: "8 lines; extend the image from Verse 1 without compressing syllables."
    },
    {
      key: "prehook2",
      label: "Pre-Hook 2",
      bars: 4,
      lineTarget: "2 lines",
      modifier: "4 bars, rising tension, answer verse",
      lyricInstruction: "2 lines; answer Verse 2 and rise into the repeated hook."
    },
    {
      key: "hook2",
      label: "Hook 2",
      bars: 8,
      lineTarget: "4 lines",
      modifier: "8 bars, full hook, repeat same text",
      lyricInstruction: "Repeat the Hook text physically, not just an instruction to repeat.",
      repeatOf: "hook1"
    },
    {
      key: "bridge",
      label: "Bridge",
      bars: 8,
      lineTarget: "3 lines",
      modifier: "8 bars, reduced drums, perspective shift",
      lyricInstruction: "3 lines; reduce drums, change viewpoint, and set up the final hook."
    },
    {
      key: "finalhook",
      label: "Final Hook",
      bars: 8,
      lineTarget: "4-5 lines",
      modifier: "8 bars, full final hook, payoff line",
      lyricInstruction: "Repeat the Hook text again and add one payoff line that resolves the image.",
      repeatOf: "hook1",
      finalPayoff: true
    },
    {
      key: "outro",
      label: "Outro",
      bars: 4,
      lineTarget: "0-1 line",
      modifier: "4 bars, resolved landing, clean stop",
      lyricInstruction: "0-1 line; land cleanly and do not open a new idea."
    }
  ]
};

function normalizeSectionLabel(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, "");
}

export function findDurationPlanSection(label: string, plan: DurationPlan = DEFAULT_USED_HONDA_DURATION_PLAN): DurationPlanSection | undefined {
  const normalized = normalizeSectionLabel(label);
  return plan.sectionPlan.find((section) => normalizeSectionLabel(section.label) === normalized);
}

export function formatDurationPlanForPrompt(plan: DurationPlan = DEFAULT_USED_HONDA_DURATION_PLAN): string {
  return [
    `DurationPlan ${plan.version}/${plan.templateId}: target ${plan.targetSeconds}s (${plan.minSeconds}-${plan.maxSeconds}s), acceptable ${plan.acceptableMinSeconds}-${plan.acceptableMaxSeconds}s.`,
    `Tempo: ${plan.bpm.target} BPM, allowed ${plan.bpm.min}-${plan.bpm.max} BPM, no double-time vocal: ${plan.bpm.noDoubleTimeVocal ? "yes" : "no"}.`,
    `Form SoT: ${plan.form}; planned bars: ${plan.totalPlannedBars}.`,
    `Chorus policy: physically repeat the hook ${plan.chorusPolicy.physicalRepeats} times; final hook mode: ${plan.chorusPolicy.finalChorusMode}.`,
    "Section plan:",
    ...plan.sectionPlan.map((section) => `- [${section.label} - ${section.modifier}]: ${section.bars} bars, ${section.lineTarget}. ${section.lyricInstruction}`)
  ].join("\n");
}

export function durationPlanCues(plan: DurationPlan = DEFAULT_USED_HONDA_DURATION_PLAN): string[] {
  return plan.sectionPlan.map((section) => `${section.label}: ${section.bars} bars, ${section.modifier}`);
}

export function durationPlanProductionNotes(plan: DurationPlan = DEFAULT_USED_HONDA_DURATION_PLAN): string[] {
  return [
    `target ${plan.targetSeconds}s with ${plan.totalPlannedBars} planned bars; do not compress sections`,
    `keep vocal pacing spacious at ${plan.bpm.target} BPM and avoid double-time delivery`,
    "let pre-hooks lift into full hooks, then drop energy in the bridge before the final hook",
    "repeat the hook text physically in Hook 2 and Final Hook so Suno hears the form"
  ];
}
