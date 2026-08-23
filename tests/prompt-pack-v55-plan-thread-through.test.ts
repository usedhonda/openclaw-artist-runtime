import { mkdtempSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSunoPromptPack } from "../src/suno-production/generatePromptPack";
import { buildStyleSynthesisPrompt } from "../src/suno-production/styleSynthesisPrompt";
import { createAndPersistSunoPromptPack } from "../src/services/sunoPromptPackFiles";
import { decideCreative } from "../src/services/creativeDirector";
import { writeSongPlan } from "../src/services/songPlan";
import type { CreativeDecision } from "../src/types";

// Persona fixture carrying every rotation section the director reads, mirroring
// the creative-director test so the plan under test is a real F1 emission, not a
// hand-rolled shape the director would never produce.
const PERSONA = `# Artist

## Sound

- Vocal identity: vocalGender: male; dry mid-range.

### Emotional Modes

- 本気 Dis: confrontational rap diss, head-on, sharp, dry menace
- 郷愁: nostalgic, warm-cold, late-night recall
- 祝祭: celebratory, crowd heat, bright pressure
- 自嘲: self-mocking, implicated, wry
- 賛美: praising, earnest under sarcasm
- 静かな肯定: quiet affirmation, low light, steady
- 困惑: bewildered, off-balance, numbers failing

### Shibuya Tag Techniques

- 技法の扱い(前書き): 渋谷を貼れる住所として扱う技法集。
- 一言タグ: どこか一行だけ渋谷を貼る。
- 産地表示: 製造元、渋谷。

### Consumption & Face Material Bank

- 素材の扱い(前書き): 撃つのは仕組み。
- 整形広告で埋まる駅: 顔のカタログ。
- 同じ顔の量産ライン: 工場の検品を通った顔。

### Net & Generation Material Bank

- 素材の扱い(前書き): 撃つのは速度。
- 炎上の賞味期限: 三日で在庫になる怒り。

### Shibuya Diss Material Bank

- 素材の扱い(安全線): 矛先は都市の仕組みへ。
- 街に上書きされる他所の言葉: 誰のための通りか。
`;

const lyrics = ["[Intro - muted street image]", "えきまえのとけいだけがすこしおくれる"].join("\n");

function planFor(songId: string): CreativeDecision {
  return decideCreative({
    songId,
    jstDate: "2026-08-23",
    personaText: PERSONA,
    observation: { url: "https://x.com/a/status/1", author: "a", motifScore: 5, text: "seed" },
    recentDecisions: []
  });
}

function baseInput() {
  return {
    songId: "song-plan-01",
    songTitle: "Plan Threaded",
    artistReason: "observation from shibuya redevelopment",
    lyricsText: lyrics,
    moodHint: "civic dread pulse",
    artistSnapshot: "# ARTIST\nnu-jazz rap civic pressure",
    currentStateSnapshot: "# CURRENT\nobservational"
  };
}

function introMoveLine(style: string): string {
  return (style.match(/- Intro Move: ([^\n]+)/)?.[1] ?? "").replace(/\.\s*$/, "");
}

describe("Suno V5.5 CreativeDecision thread-through", () => {
  it("uses the plan's archetype-derived intro styleMove, not an independent rotation", () => {
    const plan = planFor("song-plan-01");

    const withPlan = createSunoPromptPack({ ...baseInput(), creativeDecision: plan, styleVariationSeed: plan.dopagaki.variationSeed });
    const withoutPlan = createSunoPromptPack({ ...baseInput(), styleVariationSeed: plan.dopagaki.variationSeed });

    // The style Intro Move is exactly the plan's styleMove. The override replaces
    // the value inside a required line (no net length), so it survives even when
    // this cap-bound artist forces the optional hint lines to be dropped.
    expect(withPlan.style).toContain(`- Intro Move: ${plan.intro.styleMove}.`);
    // A sentinel styleMove (a string no variation profile intro pool holds) proves
    // the plan value overrides the hash rotation rather than coinciding with it.
    const sentinelPlan: CreativeDecision = { ...plan, intro: { ...plan.intro, styleMove: "sentinel offbeat intro cue" } };
    const withSentinel = createSunoPromptPack({ ...baseInput(), creativeDecision: sentinelPlan, styleVariationSeed: plan.dopagaki.variationSeed });
    expect(introMoveLine(withSentinel.style)).toBe("sentinel offbeat intro cue");
    expect(introMoveLine(withoutPlan.style)).not.toBe("sentinel offbeat intro cue");
    // Regression: the contract-required lines must survive the length trim.
    expect(withPlan.style).toContain("Variation Move");
    expect(withPlan.style).toContain("Intro Move");
    expect(withPlan.validation.valid).toBe(true);
  });

  it("renders the plan emotionalMode.spec (感情) as a style hint distinct from moodHint (音色) when there is room", () => {
    const plan = planFor("song-plan-01");
    expect(plan.emotionalMode.spec).toContain("confrontational rap diss");

    // Headroom fixture: a minimal artistSnapshot plus a variation seed that selects
    // a shorter profile, so the single optional Emotional Mode hint line fits under
    // the style length cap (the deterministic style otherwise runs near the cap).
    const roomy = { ...baseInput(), artistSnapshot: "# ARTIST", styleVariationSeed: "seed-6" };
    const withPlan = createSunoPromptPack({ ...roomy, creativeDecision: plan });
    const withoutPlan = createSunoPromptPack(roomy);

    expect(withPlan.style).toContain("Emotional Mode");
    expect(withPlan.style).toContain("confrontational rap diss");
    expect(withPlan.style).toContain("Variation Move");
    // moodHint (音色) still drives its own surfaces regardless of the plan.
    expect(withPlan.style).toContain("civic dread pulse");
    expect(withoutPlan.style).not.toContain("Emotional Mode");
    expect(withoutPlan.style).not.toContain("confrontational rap diss");
  });

  it("drops the optional hint before the required Variation Move line on cap-bound styles", () => {
    const plan = planFor("song-plan-01");
    // The default (nu-jazz) artistSnapshot is cap-bound: the Emotional Mode hint
    // cannot fit, so it is dropped and the contract line is preserved.
    const withPlan = createSunoPromptPack({ ...baseInput(), creativeDecision: plan });
    expect(withPlan.style).toContain("Variation Move");
    expect(withPlan.style).not.toContain("Emotional Mode");
    expect(withPlan.validation.valid).toBe(true);
  });

  it("takes bpm and vocalGender from the plan", () => {
    const plan = planFor("song-plan-01");
    const femalePlan: CreativeDecision = { ...plan, vocalGender: "female", tempo: { ...plan.tempo, bpm: 168 } };

    const withPlan = createSunoPromptPack({ ...baseInput(), creativeDecision: femalePlan, bpm: 168 });

    expect(withPlan.style).toContain("BPM 168");
    expect(withPlan.yamlLyrics).toContain("gender: female");
    // artistSnapshot has no gender line (would default male); female proves the
    // value came from the plan, not the snapshot regex fallback.
    expect(createSunoPromptPack(baseInput()).yamlLyrics).toContain("gender: male");
  });

  it("always carries the emotional mode, style notes, and intro move into the AI style synthesis prompt", async () => {
    const withHints = await buildStyleSynthesisPrompt({
      artistProfile: "# ARTIST",
      brief: "observation from shibuya redevelopment",
      moodHint: "civic dread pulse",
      emotionalModeSpec: "confrontational rap diss, head-on, sharp, dry menace",
      styleNotes: "thick low bass, restrained brushed drums, unsentimental delivery",
      introStyleMove: "cold intro, immediate pocket"
    });
    expect(withHints.user).toContain("Emotional mode (感情)");
    expect(withHints.user).toContain("confrontational rap diss");
    expect(withHints.user).toContain("Producer style notes");
    expect(withHints.user).toContain("thick low bass");
    expect(withHints.user).toContain("Intro move");
    expect(withHints.user).toContain("cold intro, immediate pocket");

    const withoutHints = await buildStyleSynthesisPrompt({
      artistProfile: "# ARTIST",
      brief: "observation from shibuya redevelopment",
      moodHint: "civic dread pulse"
    });
    expect(withoutHints.user).not.toContain("Emotional mode (感情)");
    expect(withoutHints.user).not.toContain("Producer style notes");
    expect(withoutHints.user).not.toContain("Intro move");
  });

  it("renders the brief Style notes into the style only when the song has a plan", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-v55-plan-notes-"));
    await mkdir(join(root, "songs", "song-notes"), { recursive: true });
    await writeFile(
      join(root, "songs", "song-notes", "brief.md"),
      ["# Brief", "", "- Tempo: 132 BPM", "- Style notes: thick low bass"].join("\n"),
      "utf8"
    );
    // Isolate the Style Notes hint: an empty emotionalMode.spec keeps it the only
    // optional hint competing for space, and the headroom snapshot + short profile
    // seed leave room for it under the style length cap.
    const plan: CreativeDecision = { ...planFor("song-notes"), songId: "song-notes", emotionalMode: { label: "", spec: "" } };
    await writeSongPlan(root, plan);

    const withPlan = await createAndPersistSunoPromptPack({
      workspaceRoot: root,
      songId: "song-notes",
      songTitle: "Notes Threaded",
      artistReason: "observation from shibuya redevelopment",
      lyricsText: lyrics,
      moodHint: "civic dread pulse",
      artistSnapshot: "# ARTIST",
      styleVariationSeed: "seed-6",
      creativeDecision: plan
    });
    expect(withPlan.pack.style).toContain("Style Notes");
    expect(withPlan.pack.style).toContain("thick low bass");

    // Legacy song: same brief, no creativeDecision -> style notes must NOT leak in
    // (byte-identity of the pre-spine path).
    const legacyRoot = mkdtempSync(join(tmpdir(), "artist-runtime-v55-legacy-notes-"));
    await mkdir(join(legacyRoot, "songs", "song-legacy"), { recursive: true });
    await writeFile(
      join(legacyRoot, "songs", "song-legacy", "brief.md"),
      ["# Brief", "", "- Tempo: 132 BPM", "- Style notes: thick low bass"].join("\n"),
      "utf8"
    );
    const legacy = await createAndPersistSunoPromptPack({
      workspaceRoot: legacyRoot,
      songId: "song-legacy",
      songTitle: "Legacy Notes",
      artistReason: "observation from shibuya redevelopment",
      lyricsText: lyrics,
      moodHint: "civic dread pulse",
      artistSnapshot: "# ARTIST"
    });
    expect(legacy.pack.style).not.toContain("Style Notes");
    expect(legacy.pack.style).not.toContain("thick low bass");
  });

  it("fills bpm from the plan when the brief carries no explicit tempo", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-v55-plan-bpm-"));
    await mkdir(join(root, "songs", "song-planbpm"), { recursive: true });
    // Brief says "artist decides" -> parseBpmFromBriefTempo returns undefined, so
    // the plan's tempo.bpm must fill in instead of the 124 duration-plan default.
    await writeFile(
      join(root, "songs", "song-planbpm", "brief.md"),
      ["# Brief", "", "- Tempo: artist decides"].join("\n"),
      "utf8"
    );
    const plan = planFor("song-planbpm");
    const planWithBpm: CreativeDecision = { ...plan, songId: "song-planbpm", tempo: { ...plan.tempo, bpm: 176 } };
    await writeSongPlan(root, planWithBpm);

    const result = await createAndPersistSunoPromptPack({
      workspaceRoot: root,
      songId: "song-planbpm",
      songTitle: "Plan BPM",
      artistReason: "observation from shibuya redevelopment",
      lyricsText: lyrics,
      moodHint: "civic dread pulse",
      creativeDecision: planWithBpm
    });
    const style = readFileSync(result.artifactPaths.styleLatest, "utf8");
    const yaml = readFileSync(result.artifactPaths.yamlLatest, "utf8");
    expect(style).toContain("BPM 176");
    expect(yaml).toContain("tempo: 176");
    expect(yaml).not.toContain("tempo: 124");
  });
});
