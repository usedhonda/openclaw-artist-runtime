import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderBrief, type BriefModel } from "../src/services/briefRenderer";
import { resolveTempoBandFromBrief, bandForBpm, getDurationPlan } from "../src/suno-production/durationPlan";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { createAndPersistSunoPromptPack } from "../src/services/sunoPromptPackFiles";
import { generateSunoRun, importSunoResults } from "../src/services/sunoRuns";
import { writeSongPlan } from "../src/services/songPlan";
import { parseBpmFromBriefTempo, readBriefTempo } from "../src/services/sunoPromptPackFiles";
import { buildLyricsDraftingPrompt } from "../src/services/lyricsDraftingPrompt";
import {
  bulletSection,
  emotionalModesFromArtist
} from "../src/services/creativeVariationPolicy";
import { extractDissBankItems } from "../src/services/creativeQualityLedger";
import { extractPersonaMotifs } from "../src/services/personaMotifExtractor";
import { diagnosePersonaContract } from "../src/services/personaContractDoctor";
import {
  ATTACK_STANCES_HEADING,
  CONSUMPTION_FACE_MATERIAL_BANK_HEADING,
  EMOTIONAL_MODES_HEADING,
  SHIBUYA_DISS_MATERIAL_BANK_HEADING,
  SHIBUYA_TAG_TECHNIQUES_HEADING,
  headingMatches,
  normalizeHeading
} from "../src/services/personaHeadings";
import type { CreativeDecision } from "../src/types";

// The `- Path:` reader that autopilotService / retryPromptPackService run inline.
function readObservationPath(briefText: string): string | undefined {
  return briefText.match(/^- Path:\s*(.+)$/m)?.[1]?.trim();
}

// The Extract reader mockStructuredDraft runs.
function readExtract(briefText: string): string | undefined {
  return briefText
    .match(/## Observation source[\s\S]*?Extract:\n([\s\S]*)/i)?.[1]
    ?.split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim();
}

function readMood(briefText: string): string | undefined {
  return briefText.match(/^\s*-\s*Mood:\s*(.+)$/im)?.[1]?.trim() || undefined;
}

describe("F6 unified brief renderer round-trip", () => {
  it("renders an ideation brief every reader parses (bug #1: bpm line present)", () => {
    const model: BriefModel = {
      title: "Glass Alibi",
      whyExists: "A public-facing song grown from 整形広告で埋まる駅.",
      coreTheme: "整形広告で埋まる駅",
      artistReason: "街の顔を刺すために低い輪郭で書く。",
      mood: "confrontational rap diss, head-on, sharp",
      emotionalModeLabel: "本気 Dis",
      tempoBand: "dopagaki",
      tempoLine: "138 BPM",
      directionExtras: ["Keep the images concrete and the chorus short"],
      observation: {
        path: "songs/song-042/observation.md",
        author: "someone",
        url: "https://x.com/a/status/1",
        quote: "quote text",
        motivation: "matched the artist direction",
        extract: "- text: \"まちのノイズがまだきえない\""
      }
    };
    const brief = renderBrief(model);

    // resolveTempoBandFromBrief reads the band marker.
    expect(resolveTempoBandFromBrief(brief)).toBe("dopagaki");
    // readBriefTempo now finds a `- Tempo:` line on the ideation path (was absent
    // pre-F6), so the bpm is no longer lost to the mid default.
    expect(readBriefTempo(brief)).toBe("138 BPM");
    expect(parseBpmFromBriefTempo(readBriefTempo(brief))).toBe(138);
    // Band and bpm agree inside one brief.
    expect(bandForBpm(138)).toBe("dopagaki");
    // Observation readers.
    expect(readObservationPath(brief)).toBe("songs/song-042/observation.md");
    expect(readExtract(brief)).toBe("- text: \"まちのノイズがまだきえない\"");
    // Mood / emotional-mode lines present.
    expect(readMood(brief)).toBe("confrontational rap diss, head-on, sharp");
    expect(brief).toContain("- Emotional mode: 本気 Dis");
    expect(brief).toContain("## Why this song exists");
    expect(brief).toContain("## Direction");
  });

  it("renders a commission brief whose band is derived from its own bpm", () => {
    const model: BriefModel = {
      title: "Ledger Night",
      commission: "六本木で見た経営者を社会風刺として切る一曲",
      lyricsTheme: "サビは短く1行、ヴァースで景色を出す",
      mood: "tense, late-night, urban pressure",
      emotionalModeLabel: "本気 Dis",
      tempoBand: bandForBpm(142),
      tempoLine: "142 BPM",
      duration: "artist decides",
      styleNotes: "thick low bass, restrained brushed drums",
      frozenSources: [
        { kind: "news", url: "https://news.example/x", author: "Desk", quote: "headline" },
        { kind: "x_reaction", url: "https://x.com/b/status/2" }
      ]
    };
    const brief = renderBrief(model);

    // The band line and the bpm line agree because both derive from 142.
    expect(readBriefTempo(brief)).toBe("142 BPM");
    expect(parseBpmFromBriefTempo(readBriefTempo(brief))).toBe(142);
    expect(resolveTempoBandFromBrief(brief)).toBe(bandForBpm(142));
    // New commission lines.
    expect(brief).toContain("- Emotional mode: 本気 Dis");
    expect(brief).toContain(`- Tempo band: ${bandForBpm(142)}`);
    // Frozen sources formatting preserved.
    expect(brief).toContain("## Frozen sources");
    expect(brief).toContain("- news: https://news.example/x (Desk) — headline");
    expect(brief).toContain("- x_reaction: https://x.com/b/status/2");
    // One schema: same Direction header as the ideation path.
    expect(brief).toContain("## Producer commission");
    expect(brief).toContain("## Direction");
  });

  it("keeps a deferred commission tempo (\"artist decides\") consistent with the plan band", () => {
    const model: BriefModel = {
      title: "Deferred",
      commission: "commission text",
      lyricsTheme: "theme",
      mood: "mood",
      emotionalModeLabel: "本気 Dis",
      tempoBand: "up", // from the persisted decision when the string has no bpm
      tempoLine: "artist decides",
      duration: "artist decides",
      styleNotes: "notes"
    };
    const brief = renderBrief(model);
    // No numeric bpm to extract, so readers defer to the plan band on the band line.
    expect(readBriefTempo(brief)).toBe("artist decides");
    expect(parseBpmFromBriefTempo(readBriefTempo(brief))).toBeUndefined();
    expect(resolveTempoBandFromBrief(brief)).toBe("up");
  });
});

const TOLERANT_PERSONA = [
  "# Artist",
  "",
  "## Sound",
  "",
  "- Vocal identity: vocalGender: male; dry mid-range.",
  "",
  // trailing space after the heading
  "###   Emotional Modes ",
  "",
  "- 本気 Dis: confrontational rap diss, head-on, sharp, dry menace",
  "- 郷愁: nostalgic, warm-cold, late-night recall",
  "- 祝祭: celebratory, crowd heat, bright pressure",
  "- 自嘲: self-mocking, implicated, wry",
  "- 賛美: praising, earnest under sarcasm",
  "- 静かな肯定: quiet affirmation, low light, steady",
  "- 困惑: bewildered, off-balance, numbers failing",
  "",
  // lower-case heading
  "### shibuya tag techniques",
  "",
  "- 技法の扱い(前書き): 渋谷を貼れる住所として扱う技法集。",
  "- 一言タグ: どこか一行だけ渋谷を貼る。",
  "- 産地表示: 製造元、渋谷。",
  "- 単位化: 渋谷を数える単位にする。",
  "- 診断名: 症状として渋谷を書く。",
  "- 地名の代入: 別の街を渋谷に置換。",
  "- 住民登録: 刺す相手を渋谷の住人に。",
  "- 最後の一撃: 落ちで渋谷を刺す。",
  "- 時間差: 後から渋谷が効く。",
  "- 翻訳: 世代語を渋谷語に訳す。",
  "",
  // full-width space inside the heading
  "### Critique　Lens",
  "",
  "- Start from the material and follow the systems.",
  "",
  "### Attack Stances",
  "",
  "- A 消費と顔: 名指しの挑発 / 実況中継 / 伝票の暴露 / 数字で殴る",
  "- B ネットと世代: 切り抜きの実況 / 推し活経済の暴露 / 世代語の翻訳 / 炎上の損益",
  "- C 渋谷と都市: 再開発の実況 / 観光地化の暴露 / 見下ろし / 数字で殴る",
  "",
  // trailing space on a material bank heading
  "### Consumption & Face Material Bank ",
  "",
  "- 素材の扱い(前書き): 撃つのは仕組み。",
  "- 整形広告で埋まる駅: 顔のカタログ。",
  "",
  "### Net & Generation Material Bank",
  "",
  "- 炎上の賞味期限: 三日で在庫になる怒り。",
  "",
  // lower-case diss bank heading
  "### shibuya diss material bank",
  "",
  "- 素材の扱い(安全線): 矛先は都市の仕組みへ。",
  "- 街に上書きされる他所の言葉: 誰のための通りか。",
  "",
  "Signature line: 値段の裏側 / 舞台裏"
].join("\n");

describe("F6 heading normalization tolerance", () => {
  it("normalizeHeading folds trim / case / markdown markers / full-width space", () => {
    expect(normalizeHeading("###   Emotional Modes ")).toBe("emotional modes");
    expect(normalizeHeading("emotional modes")).toBe("emotional modes");
    expect(normalizeHeading("### Critique　Lens")).toBe("critique lens");
    expect(headingMatches("### shibuya diss material bank", SHIBUYA_DISS_MATERIAL_BANK_HEADING)).toBe(true);
    expect(headingMatches("### Emotional Modes", "emotional modes")).toBe(true);
    expect(headingMatches("### Something Else", EMOTIONAL_MODES_HEADING)).toBe(false);
  });

  it("every parser still finds its section despite hand edits to the headings", () => {
    // bulletSection tolerates the trailing space + case.
    expect(bulletSection(TOLERANT_PERSONA, ATTACK_STANCES_HEADING).length).toBeGreaterThanOrEqual(3);
    // emotionalModesFromArtist parses 7 modes (not the 6-mode generic fallback).
    const modes = emotionalModesFromArtist(TOLERANT_PERSONA);
    expect(modes.length).toBe(7);
    expect(modes.some((mode) => /dis/i.test(mode.label))).toBe(true);
    // diss-bank items despite the lower-case heading.
    expect(extractDissBankItems(TOLERANT_PERSONA)).toContain("街に上書きされる他所の言葉");
    // material banks despite trailing space.
    const banks = extractPersonaMotifs(TOLERANT_PERSONA).materialBankGroups;
    expect(banks?.consumptionFace).toContain("整形広告で埋まる駅");
    expect(banks?.shibuyaDiss.length ?? 0).toBeGreaterThan(0);
  });

  it("the doctor shares the parser constants so they cannot drift", () => {
    // The doctor runs the same parsers over the tolerant persona and passes every
    // contract — proof it reads the same normalized headings the parsers do.
    const report = diagnosePersonaContract(TOLERANT_PERSONA);
    const failing = report.checks.filter((check) => !check.ok).map((check) => check.id);
    expect(failing).toEqual([]);
    // The canonical constants normalize to the phrases the parsers match.
    expect(normalizeHeading(CONSUMPTION_FACE_MATERIAL_BANK_HEADING)).toBe("consumption & face material bank");
    expect(normalizeHeading(SHIBUYA_TAG_TECHNIQUES_HEADING)).toBe("shibuya tag techniques");
  });
});

function decisionFixture(spec: string): CreativeDecision {
  return {
    version: 1,
    songId: "song-plan-first",
    decidedAt: "2026-08-23T00:00:00.000Z",
    seed: "song-plan-first\n2026-08-23\n",
    lens: "consumption_face",
    lensMaterial: ["整形広告で埋まる駅"],
    attackStance: "名指しの挑発",
    emotionalMode: { label: "本気 Dis", spec },
    aggression: "dis",
    tempo: { band: "up", bpm: 122 },
    dopagaki: { active: false, threshold: 0.4, variationSeed: "spacious:song-plan-first:0.9" },
    intro: { archetype: "cold_open", modifier: "2 bars, cold open", lyricInstruction: "0 lines", styleMove: "cold intro" },
    hookShape: "one_line",
    shibuyaTag: "一言タグ",
    signature: ["値段の裏側"],
    observation: null,
    degradedInputs: [],
    vocalGender: "male"
  };
}

describe("F6 plan-first fallback for the lyrics prompt mood", () => {
  const brief = ["# Brief for X", "", "## Direction", "", "- Mood: legacy brief mood string"].join("\n");

  it("reads the plan's emotionalMode.spec when a decision is present", () => {
    const prompt = buildLyricsDraftingPrompt({
      artistMd: "# ARTIST",
      currentState: "# CURRENT",
      briefText: brief,
      title: "X",
      knowledgeDigest: "",
      decision: decisionFixture("confrontational rap diss from the plan")
    });
    expect(prompt).toContain("Emotional mode for this song: confrontational rap diss from the plan");
    expect(prompt).not.toContain("Emotional mode for this song: legacy brief mood string");
  });

  it("falls back to the brief `- Mood:` string for legacy songs with no plan", () => {
    const prompt = buildLyricsDraftingPrompt({
      artistMd: "# ARTIST",
      currentState: "# CURRENT",
      briefText: brief,
      title: "X",
      knowledgeDigest: ""
    });
    expect(prompt).toContain("Emotional mode for this song: legacy brief mood string");
  });
});

describe("F6 plan-first fallback for the sunoRuns duration target", () => {
  async function prepareRun(songId: string): Promise<{ root: string; runId: string }> {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-f6-sunoruns-"));
    await ensureArtistWorkspace(root);
    await createAndPersistSunoPromptPack({
      workspaceRoot: root,
      songId,
      songTitle: "Duration Target",
      artistReason: "band mismatch",
      lyricsText: "station glass under static",
      knowledgePackVersion: "test-pack"
    });
    const generated = await generateSunoRun({ workspaceRoot: root, songId });
    return { root, runId: generated.runId };
  }

  const durationSec = 200;

  it("uses the plan's tempo band for the duration target, ignoring a disagreeing brief band", async () => {
    const songId = "song-001";
    const { root, runId } = await prepareRun(songId);
    // Brief says "up"; the plan says "dopagaki" (a band with a distinct target).
    // Plan-first must win.
    await writeFile(
      join(root, "songs", songId, "brief.md"),
      ["# Brief for X", "", "## Direction", "", "- Tempo band: up", "- Tempo: 122 BPM"].join("\n"),
      "utf8"
    );
    const plan = { songId, tempo: { band: "dopagaki" as const, bpm: 138 } } as never;
    await writeSongPlan(root, plan);

    const record = await importSunoResults({
      workspaceRoot: root,
      songId,
      runId,
      urls: ["https://suno.com/song/track-1"],
      metadata: [{ url: "https://suno.com/song/track-1", path: join(root, "t.mp3"), format: "mp3", durationSec }]
    });
    expect(record.durationDeltaSec).toBe(durationSec - getDurationPlan("dopagaki").targetSeconds);
    expect(record.durationDeltaSec).not.toBe(durationSec - getDurationPlan("up").targetSeconds);
  });

  it("falls back to the brief band for a legacy song with no plan", async () => {
    const songId = "song-001";
    const { root, runId } = await prepareRun(songId);
    await writeFile(
      join(root, "songs", songId, "brief.md"),
      ["# Brief for X", "", "## Direction", "", "- Tempo band: super", "- Tempo: 148 BPM"].join("\n"),
      "utf8"
    );
    // No plan written.
    const record = await importSunoResults({
      workspaceRoot: root,
      songId,
      runId,
      urls: ["https://suno.com/song/track-1"],
      metadata: [{ url: "https://suno.com/song/track-1", path: join(root, "t.mp3"), format: "mp3", durationSec }]
    });
    expect(record.durationDeltaSec).toBe(durationSec - getDurationPlan("super").targetSeconds);
  });
});
