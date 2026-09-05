import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendCreativeQualityEntry,
  creativeMonotonyTombstonePath,
  creativeStreakSignature,
  detectCreativeStreaks,
  evaluateCreativeMonotony,
  type CreativeQualityEntry
} from "../src/services/creativeQualityLedger";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
import { TelegramNotifier } from "../src/services/telegramNotifier";
import type { CreativeDecision } from "../src/types";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-monotony-"));
}

function telegramResponse(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
}

function decision(overrides: Partial<CreativeDecision> = {}): CreativeDecision {
  return {
    version: 1,
    songId: "song-x",
    decidedAt: "2026-08-23T00:00:00.000Z",
    seed: "seed",
    lens: "consumption_face",
    lensMaterial: ["整形広告で埋まる駅"],
    attackStance: "数字で殴る",
    emotionalMode: { label: "本気 Dis", spec: "confrontational rap diss" },
    aggression: "dis",
    tempo: { band: "up", bpm: 122 },
    dopagaki: { active: false, threshold: 0.4, variationSeed: "s" },
    intro: {
      archetype: "cold_open",
      modifier: "m",
      lyricInstruction: "i",
      styleMove: "cold intro"
    },
    hookShape: "number",
    shibuyaTag: "産地表示",
    signature: ["数字で読む癖"],
    observation: null,
    degradedInputs: [],
    vocalGender: "male",
    ...overrides
  };
}

function entry(overrides: Partial<CreativeQualityEntry> = {}): CreativeQualityEntry {
  return {
    songId: `song-${Math.random().toString(36).slice(2, 8)}`,
    title: "Test",
    createdAt: new Date().toISOString(),
    dopagakiActive: false,
    dopagakiThreshold: 0.4,
    bareLyricsChars: 1200,
    bareLines: 52,
    moodHint: "civic dread pulse",
    dissBankHits: [],
    dissBankHitCount: 0,
    degraded: false,
    ...overrides
  };
}

describe("detectCreativeStreaks", () => {
  it("detects the same lens 3 songs in a row", () => {
    const entries = [
      entry({ decision: decision({ lens: "consumption_face" }) }),
      entry({ decision: decision({ lens: "consumption_face" }) }),
      entry({ decision: decision({ lens: "consumption_face" }) })
    ];
    const streaks = detectCreativeStreaks(entries);
    expect(streaks).toContainEqual({ kind: "lens", value: "consumption_face", length: 3 });
  });

  it("does not flag a lens run of only 2 (threshold is 3)", () => {
    const entries = [
      entry({ decision: decision({ lens: "consumption_face" }) }),
      entry({ decision: decision({ lens: "consumption_face" }) }),
      entry({ decision: decision({ lens: "net_generation" }) })
    ];
    expect(detectCreativeStreaks(entries).some((streak) => streak.kind === "lens")).toBe(false);
  });

  it("detects the same structure 3 songs in a row", () => {
    const entries = [
      entry({ decision: decision({ structure: "hook_first" }) }),
      entry({ decision: decision({ structure: "hook_first" }) }),
      entry({ decision: decision({ structure: "hook_first" }) })
    ];
    const streaks = detectCreativeStreaks(entries);
    expect(streaks).toContainEqual({ kind: "structure", value: "hook_first", length: 3 });
  });

  it("does not flag a structure run of only 2 (threshold is 3)", () => {
    const entries = [
      entry({ decision: decision({ structure: "hook_first" }) }),
      entry({ decision: decision({ structure: "hook_first" }) }),
      entry({ decision: decision({ structure: "standard" }) })
    ];
    expect(detectCreativeStreaks(entries).some((streak) => streak.kind === "structure")).toBe(false);
  });

  it("does not flag a structure streak when one of the 3 entries lacks the field", () => {
    const entries = [
      entry({ decision: decision({ structure: "hook_first" }) }),
      entry({ decision: decision({ structure: undefined }) }),
      entry({ decision: decision({ structure: "hook_first" }) })
    ];
    expect(detectCreativeStreaks(entries).some((streak) => streak.kind === "structure")).toBe(false);
  });

  it("detects aggression=changeup twice in a row", () => {
    const entries = [
      entry({ decision: decision({ aggression: "changeup" }) }),
      entry({ decision: decision({ aggression: "changeup" }) }),
      entry({ decision: decision({ aggression: "dis" }) })
    ];
    expect(detectCreativeStreaks(entries)).toContainEqual({
      kind: "aggression_changeup",
      value: "changeup",
      length: 2
    });
  });

  it("detects the same attack stance twice in a row", () => {
    const entries = [
      entry({ decision: decision({ attackStance: "実況中継" }) }),
      entry({ decision: decision({ attackStance: "実況中継" }) }),
      entry({ decision: decision({ attackStance: "伝票の暴露" }) })
    ];
    expect(detectCreativeStreaks(entries)).toContainEqual({
      kind: "attack_stance",
      value: "実況中継",
      length: 2
    });
  });

  it("detects the same intro archetype twice, including the older entry.introArchetype fallback", () => {
    const fromDecision = detectCreativeStreaks([
      entry({ decision: decision({ intro: { ...decision().intro, archetype: "scene_set" } }) }),
      entry({ decision: decision({ intro: { ...decision().intro, archetype: "scene_set" } }) })
    ]);
    expect(fromDecision).toContainEqual({ kind: "intro_archetype", value: "scene_set", length: 2 });

    const fromFallback = detectCreativeStreaks([
      entry({ introArchetype: "atmospheric" }),
      entry({ introArchetype: "atmospheric" })
    ]);
    expect(fromFallback).toContainEqual({ kind: "intro_archetype", value: "atmospheric", length: 2 });
  });

  it("does not mistake the artist-led opening contract for a repeated sonic form", () => {
    const entries = [
      entry({ decision: decision({ intro: { ...decision().intro, archetype: "artist_led" } }) }),
      entry({ decision: decision({ intro: { ...decision().intro, archetype: "artist_led" } }) })
    ];
    expect(detectCreativeStreaks(entries).some((streak) => streak.kind === "intro_archetype")).toBe(false);
  });

  it("detects a >=2-char kanji/katakana word shared by two consecutive titles", () => {
    const entries = [
      entry({ title: "整形の顔" }),
      entry({ title: "整形の列" }),
      entry({ title: "別のテーマ" })
    ];
    expect(detectCreativeStreaks(entries)).toContainEqual({
      kind: "title_word",
      value: "整形",
      length: 2
    });
  });

  it("returns no streaks for a varied window", () => {
    const entries = [
      entry({ title: "朝の顔", decision: decision({ lens: "consumption_face", attackStance: "a", aggression: "dis", intro: { ...decision().intro, archetype: "cold_open" } }) }),
      entry({ title: "夜の熱", decision: decision({ lens: "net_generation", attackStance: "b", aggression: "dis", intro: { ...decision().intro, archetype: "scene_set" } }) }),
      entry({ title: "街の風", decision: decision({ lens: "shibuya_city", attackStance: "c", aggression: "dis", intro: { ...decision().intro, archetype: "atmospheric" } }) })
    ];
    expect(detectCreativeStreaks(entries)).toEqual([]);
  });

  it("signature excludes length so a growing streak stays one incident", () => {
    const three = creativeStreakSignature([{ kind: "lens", value: "consumption_face", length: 3 }]);
    const four = creativeStreakSignature([{ kind: "lens", value: "consumption_face", length: 4 }]);
    expect(three).toBe(four);
  });
});

describe("evaluateCreativeMonotony", () => {
  afterEach(() => {
    getRuntimeEventBus().clearForTest();
  });

  const STANCES = ["s-a", "s-b", "s-c", "s-d", "s-e", "s-f", "s-g"];
  const ARCHETYPES = ["cold_open", "scene_set", "atmospheric", "count_in", "spoken_cue", "silence_hit", "instrumental"];
  // Distinct 2-char titles so no title_word run forms incidentally.
  const TITLES = ["朝焼", "夜風", "街角", "雨音", "光線", "残響", "潮騒"];

  // Builds a distinct entry for a lens, varying attackStance / intro / title so the
  // ONLY streak in play is the lens repetition (no incidental stance/intro/title runs).
  async function appendLensEntry(root: string, songId: string, lens: CreativeDecision["lens"], n: number): Promise<void> {
    await appendCreativeQualityEntry(
      root,
      entry({
        songId,
        title: TITLES[n % TITLES.length],
        decision: decision({
          lens,
          attackStance: STANCES[n % STANCES.length],
          intro: { ...decision().intro, archetype: ARCHETYPES[n % ARCHETYPES.length] }
        })
      })
    );
  }

  async function seedLensStreak(root: string): Promise<void> {
    // Appended oldest-first; readCreativeQualityLedger returns newest-first.
    await appendLensEntry(root, "s1", "consumption_face", 1);
    await appendLensEntry(root, "s2", "consumption_face", 2);
    await appendLensEntry(root, "s3", "consumption_face", 3);
  }

  it("emits the runtime event once per incident and writes a tombstone", async () => {
    const root = workspace();
    const events: RuntimeEvent[] = [];
    getRuntimeEventBus().subscribe((event) => {
      if (event.type === "creative_monotony_warning") events.push(event);
    });
    await seedLensStreak(root);

    const first = await evaluateCreativeMonotony(root);
    expect(first.notified).toBe(true);
    expect(events).toHaveLength(1);

    // Same streak again: tombstone gates the second notice.
    const second = await evaluateCreativeMonotony(root);
    expect(second.notified).toBe(false);
    expect(events).toHaveLength(1);

    const tombstone = JSON.parse(await readFile(creativeMonotonyTombstonePath(root), "utf8"));
    expect(tombstone.signature).toBe(creativeStreakSignature(first.streaks));
  });

  it("clears the tombstone when the streak breaks and re-notifies on recurrence", async () => {
    const root = workspace();
    const events: RuntimeEvent[] = [];
    getRuntimeEventBus().subscribe((event) => {
      if (event.type === "creative_monotony_warning") events.push(event);
    });
    await seedLensStreak(root);
    await evaluateCreativeMonotony(root);
    expect(events).toHaveLength(1);

    // Break the streak with two different-lens songs at the head.
    await appendLensEntry(root, "s4", "net_generation", 4);
    await appendLensEntry(root, "s5", "shibuya_city", 5);
    const broken = await evaluateCreativeMonotony(root);
    expect(broken.streaks).toEqual([]);
    await expect(readFile(creativeMonotonyTombstonePath(root), "utf8")).rejects.toThrow();

    // Streak reforms -> new incident notifies again.
    await appendLensEntry(root, "s6", "shibuya_city", 6);
    await appendLensEntry(root, "s7", "shibuya_city", 0);
    const recurrence = await evaluateCreativeMonotony(root);
    expect(recurrence.notified).toBe(true);
    expect(events).toHaveLength(2);
  });

  it("sends exactly one Telegram notice via the subscribed notifier", async () => {
    const root = workspace();
    const fetchImpl = vi.fn().mockResolvedValue(telegramResponse({ message_id: 1, chat: { id: 7 } }));
    const notifier = new TelegramNotifier({ token: "t", chatId: 7, workspaceRoot: root, fetchImpl });
    notifier.subscribe(getRuntimeEventBus());
    await seedLensStreak(root);

    await evaluateCreativeMonotony(root);
    await evaluateCreativeMonotony(root);

    const monotonyCalls = () =>
      fetchImpl.mock.calls.filter((call) => {
        const body = call[1] && typeof (call[1] as RequestInit).body === "string"
          ? String((call[1] as RequestInit).body)
          : "";
        return body.includes("作風が単調");
      });
    await vi.waitFor(() => expect(monotonyCalls()).toHaveLength(1));
  });
});

describe("detectCreativeStreaks — catchphrase", () => {
  it("flags a catchphrase id used by the two newest songs", () => {
    const streaks = detectCreativeStreaks([
      entry({ usedCatchphrases: ["zenin_shibuya", "donki"] }),
      entry({ usedCatchphrases: ["zenin_shibuya"] }),
      entry({ usedCatchphrases: [] })
    ]);
    expect(streaks).toContainEqual({ kind: "catchphrase", value: "zenin_shibuya", length: 2 });
  });

  it("extends the run downward while consecutive songs keep the id", () => {
    const streaks = detectCreativeStreaks([
      entry({ usedCatchphrases: ["donki"] }),
      entry({ usedCatchphrases: ["donki"] }),
      entry({ usedCatchphrases: ["donki"] }),
      entry({ usedCatchphrases: [] })
    ]);
    expect(streaks).toContainEqual({ kind: "catchphrase", value: "donki", length: 3 });
  });

  it("does not flag when only the newest song used a catchphrase", () => {
    const streaks = detectCreativeStreaks([
      entry({ usedCatchphrases: ["zenin_shibuya"] }),
      entry({ usedCatchphrases: [] })
    ]);
    expect(streaks.some((streak) => streak.kind === "catchphrase")).toBe(false);
  });

  it("does not flag when the two newest songs used different catchphrases", () => {
    const streaks = detectCreativeStreaks([
      entry({ usedCatchphrases: ["zenin_shibuya"] }),
      entry({ usedCatchphrases: ["donki"] })
    ]);
    expect(streaks.some((streak) => streak.kind === "catchphrase")).toBe(false);
  });
});
