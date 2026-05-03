// Plan v10.7 Phase 5 smoke: distribution path 全体で sunomanual が
// inline 化されており、AI prompt / deterministic builder の双方が
// path 依存なしで full knowledge を引けることを assert する。
import { describe, expect, it } from "vitest";
import { KNOWLEDGE_BUNDLE, KNOWLEDGE_FILES } from "../src/suno-production/knowledge-bundle.js";
import { readLyricsKnowledgeDigest } from "../src/services/lyricsDraftingPrompt.js";
import { readStyleKnowledgeDigest } from "../src/suno-production/styleSynthesisPrompt.js";
import { buildStyle } from "../src/suno-production/buildStyle.js";
import { buildYaml, computeBudgetLevel } from "../src/suno-production/buildYaml.js";
import { buildExclude } from "../src/suno-production/buildExclude.js";
import { isCommandLeakLine } from "../src/services/lyricsValidator.js";

describe("Plan v10.7 distribution smoke", () => {
  it("ships every sunomanual file as inline string constants", () => {
    expect(KNOWLEDGE_FILES.length).toBe(9);
    for (const filename of KNOWLEDGE_FILES) {
      expect(KNOWLEDGE_BUNDLE[filename].length, filename).toBeGreaterThan(0);
    }
    expect(KNOWLEDGE_BUNDLE["master_reference.md"].length).toBeGreaterThan(50_000);
  });

  it("readLyricsKnowledgeDigest returns content from inline bundle without fs lookup", async () => {
    const digest = await readLyricsKnowledgeDigest();
    expect(digest.length).toBeGreaterThan(5_000);
    expect(digest).toMatch(/##\s+master_reference\.md/);
    expect(digest).toMatch(/##\s+lyric_craft\.md/);
  });

  it("readStyleKnowledgeDigest returns content from inline bundle without fs lookup", async () => {
    const digest = await readStyleKnowledgeDigest();
    expect(digest.length).toBeGreaterThan(5_000);
    expect(digest).toMatch(/##\s+yaml_template\.md/);
    expect(digest).toMatch(/##\s+style_catalog\.md/);
  });

  it("buildStyle reaches the 800-1000 char dense band for every supported genre", () => {
    const genres = ["nu-jazz rap", "alternative pop", "edm", "post-punk", "rap"];
    for (const genre of genres) {
      const result = buildStyle({ genre, vibe: "observational dusk", bpm: 124 });
      expect(result.total.length, genre).toBeGreaterThanOrEqual(800);
      expect(result.total.length, genre).toBeLessThanOrEqual(1000);
    }
  });

  it("buildYaml computeBudgetLevel covers all four levels by lyric length", () => {
    const tinyLyrics = "[Hook]\nshort line".padEnd(4400, "x");
    expect(computeBudgetLevel(tinyLyrics)).toBe("minimal");

    const mediumLyrics = "lyrics body".padEnd(3900, "y");
    expect(computeBudgetLevel(mediumLyrics)).toBe("normal");

    const longLyrics = "lyrics body".padEnd(3500, "z");
    expect(computeBudgetLevel(longLyrics)).toBe("expanded");

    const shortLyrics = "lyrics body";
    expect(computeBudgetLevel(shortLyrics)).toBe("max");
  });

  it("buildYaml produces typed META and lyrics body without destructive truncate", () => {
    const yaml = buildYaml({
      title: "Smoke",
      lyrics: "[Verse 1]\nhello world",
      meta: { tempo: 120, key: "C minor", vibe: "observational dusk" }
    });
    expect(yaml).toContain("# META");
    expect(yaml).toContain("LYRICS START");
    expect(yaml).toContain("LYRICS END");
    expect(yaml.length).toBeLessThanOrEqual(4500);
  });

  it("buildExclude applies typed genreClashMap matches", () => {
    const rap = buildExclude({ genre: "nu-jazz rap" });
    expect(rap.items).toContain("opera vibrato");
    const edm = buildExclude({ genre: "edm" });
    expect(edm.items).toContain("acoustic campfire strum");
  });

  it("isCommandLeakLine catches the song-008 Bgm Gate leak fixtures", () => {
    const leakSamples = [
      "flow = リズム + phrasing + accent + rhyme",
      "perfect rhyme: light / night, でもここは night / ないと",
      "Lyrics = What, Style = How, そこだけは ぶれない",
      "同語反転型, さしだすひとが きえた",
      "3-6語のhook, くちがさきに おぼえる",
      "4 barsごとに flow のどれか かえる"
    ];
    for (const sample of leakSamples) {
      expect(isCommandLeakLine(sample), sample).toBe(true);
    }
    expect(isCommandLeakLine("[Verse 1 - tight flow]")).toBe(false);
    expect(isCommandLeakLine("だれかのちえんが, だれかのしごとを たたき")).toBe(false);
  });
});
