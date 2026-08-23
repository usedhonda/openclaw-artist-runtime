import { describe, expect, it } from "vitest";
import {
  extractPersonaMotifs,
  extractTagSet,
  pickWeightedMotif,
  summarizeMotifs,
  topQueryKeywords
} from "../src/services/personaMotifExtractor";

const sampleArtistMd = `# ARTIST.md

## Public Identity

Artist name: used::honda

## Sound

- Genre DNA: hip-hop
- nu-jazz rap
- progressive rap
- 楽器: 生音ドラム、太いエレベ、Rhodes、ホーンセクション
- 高速ジャズドラムにラップが乗る緊張感
- 時代感: 2000年代NYアンダーグラウンド〜現代ブルックリン

## Lyrics

- テーマ: 日本語の社会風刺。X（Twitter）で話題になったニュース・事象を中心に取り上げる。権力構造の矛盾、皮肉とユーモア
- 地理的スタンス: 六本木が生息地（オフィス含む）。渋谷・新宿は好機があればディスってよい。再開発の失敗、文化の均質化
- 視点: 経営者の目で見た衰退論。地べたも知っている二面性
- 語彙: ビジネス用語と俗語の衝突
- 韻: 高速テンポに合わせて硬く踏む
- 避けること:
  - 自己紹介
  - 説明口調
  - 感情語連打
`;

describe("persona motif extractor", () => {
  it("returns empty buckets for empty input", () => {
    const motifs = extractPersonaMotifs("");
    expect(motifs.themes).toEqual([]);
    expect(motifs.vocabulary).toEqual([]);
    expect(motifs.geographies).toEqual([]);
    expect(motifs.sound).toEqual([]);
    expect(motifs.avoid).toEqual([]);
  });

  it("captures themes/geographies/sound/avoid from a structured ARTIST.md", () => {
    const motifs = extractPersonaMotifs(sampleArtistMd);
    expect(motifs.themes).toContain("社会風刺");
    expect(motifs.themes).toContain("再開発");
    expect(motifs.geographies).toContain("六本木");
    expect(motifs.geographies).toContain("渋谷");
    expect(motifs.geographies).toContain("ブルックリン");
    expect(motifs.sound).toContain("nu-jazz rap");
    expect(motifs.sound.some((value) => value.toLowerCase().includes("rhodes"))).toBe(true);
    expect(motifs.avoid).toContain("自己紹介");
    expect(motifs.avoid).toContain("感情語連打");
  });

  it("orders motif keywords with geographies first, then themes", () => {
    const motifs = extractPersonaMotifs(sampleArtistMd);
    const keywords = topQueryKeywords(motifs, 5);
    expect(keywords.length).toBeGreaterThanOrEqual(3);
    expect(keywords[0]).toBe("六本木");
    expect(keywords).toContain("渋谷");
    const themeIndex = keywords.findIndex((value) => value === "社会風刺");
    if (themeIndex !== -1) {
      const geoIndex = keywords.findIndex((value) => value === "六本木");
      expect(geoIndex).toBeLessThan(themeIndex);
    }
  });

  it("extracts noun phrases from each exact material bank heading", () => {
    const motifs = extractPersonaMotifs(`
### Consumption & Face Material Bank
- 素材の扱い: 安全線の説明。
- 鏡張りのラウンジ: 見栄のための内装
### Net & Generation Material Bank
- 通知疲れ: 既読の墓場
### Shibuya Diss Material Bank
- 再開発の仮囲い: 街の借り物
`);
    expect(motifs.themes).toEqual(expect.arrayContaining(["鏡張りのラウンジ", "通知疲れ", "再開発の仮囲い"]));
    expect(motifs.vocabulary).toEqual(expect.arrayContaining(["鏡張りのラウンジ", "通知疲れ", "再開発の仮囲い"]));
    expect(motifs.themes).not.toContain("素材の扱い");
  });

  it("keeps long material-bank nouns for scoring while excluding them from queries", () => {
    const longNoun = "終電後のブランド看板が何本も連なる大きな歩道橋";
    const motifs = extractPersonaMotifs(`### Consumption & Face Material Bank\n- ${longNoun}: 観察対象`);
    expect(motifs.themes).toContain(longNoun);
    expect(motifs.vocabulary).toContain(longNoun);
    expect(topQueryKeywords(motifs)).not.toContain(longNoun);
  });

  it("excludes nationality labels from motifs and query candidates", () => {
    const motifs = extractPersonaMotifs(`### Net & Generation Material Bank\n- チャイナ: label\n- 外人だらけ: label\n- 通知疲れ: material`);
    expect(motifs.themes).not.toEqual(expect.arrayContaining(["チャイナ", "外人だらけ"]));
    expect(motifs.vocabulary).not.toEqual(expect.arrayContaining(["チャイナ", "外人だらけ"]));
    expect(topQueryKeywords({ ...motifs, themes: [...motifs.themes, "チャイナ"], vocabulary: [...motifs.vocabulary, "外人だらけ"] }))
      .not.toEqual(expect.arrayContaining(["チャイナ", "外人だらけ"]));
  });

  it("deterministically rotates toward vocabulary outside the recent primary lens", () => {
    const motifs = extractPersonaMotifs(`
### Consumption & Face Material Bank
- 鏡張りのラウンジ: 見栄
### Net & Generation Material Bank
- 通知疲れ: 既読
### Shibuya Diss Material Bank
- 路地裏: 再開発
`);
    const options = { seed: "0", recentBriefText: "通知疲れの既読地獄" };
    const first = topQueryKeywords(motifs, 5, options);
    const second = topQueryKeywords(motifs, 5, options);
    expect(first).toEqual(second);
    expect(first[0]).toBe("鏡張りのラウンジ");
    expect(first.slice(0, 2)).not.toContain("通知疲れ");
  });

  it("summarizes motifs into a one-line digest", () => {
    const motifs = extractPersonaMotifs(sampleArtistMd);
    const summary = summarizeMotifs(motifs);
    expect(summary).toContain("themes:");
    expect(summary).toContain("geo:");
    expect(summary.length).toBeLessThan(240);
  });
});

  it("keeps every material bank inside the motif cap", () => {
    // A concatenated bank order let the first bank fill the 16-item cap, so the
    // Net & Generation and Shibuya banks never reached the lyric prompt and four
    // songs in a row came back with the same 整形広告 / 同じ顔 theme.
    const persona = [
      "### Consumption & Face Material Bank",
      ...Array.from({ length: 14 }, (_, index) => `- 消費素材${index + 1}: 説明。`),
      "### Net & Generation Material Bank",
      "- 炎上の賞味期限: 熱が在庫になる。",
      "- 十五秒の寿命: 一曲が切られる。",
      "### Shibuya Diss Material Bank",
      "- 逃げ出した若い子の空席: 最初の世代がもういない。"
    ].join("\n");

    const motifs = extractPersonaMotifs(persona);

    expect(motifs.themes).toContain("炎上の賞味期限");
    expect(motifs.themes).toContain("逃げ出した若い子の空席");
  });

describe("pickWeightedMotif", () => {
  it("returns undefined for an empty bucket", () => {
    expect(pickWeightedMotif([])).toBeUndefined();
  });

  it("returns the only entry for a single-item bucket", () => {
    expect(pickWeightedMotif(["solo"])).toBe("solo");
  });

  it("favors leading ARTIST.md seeds when no observation bias is present", () => {
    // With rng pinned near zero, the cumulative weight should land on the
    // first bucket entry, mirroring legacy [0] behavior. With rng near 1,
    // a later entry should win — proof the rotation is real.
    const bucket = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta"];
    expect(pickWeightedMotif(bucket, [], () => 0)).toBe("alpha");
    expect(pickWeightedMotif(bucket, [], () => 0.999)).toBe("eta");
  });

  it("biases toward observation top tags when they match a bucket entry", () => {
    const bucket = ["alpha", "beta", "gamma"];
    const obsTags = ["gamma"];
    // Pin rng to land in the middle of the cumulative weight range; observation
    // bonus should now lift "gamma" enough that mid-range rolls reach it.
    // With weights default 1+ARTIST.md order bonus + observation bonus:
    //   alpha = 1 + 2 = 3
    //   beta  = 1 + 2 = 3
    //   gamma = 1 + 2 + 1 = 4   (observation top tag bonus)
    // total = 10. mid-roll 0.7 * 10 = 7, falls in gamma's slot (cumulative 6..10).
    expect(pickWeightedMotif(bucket, obsTags, () => 0.7)).toBe("gamma");
  });
});

describe("extractTagSet", () => {
  it("returns an empty set for empty input", () => {
    expect(extractTagSet("").size).toBe(0);
  });

  it("scans naked brief text for theme / geo / vocabulary seeds without ARTIST.md heading structure", () => {
    const text = "再開発で古いライブハウスが消え、 跡地に同じ色の看板。 六本木の経営者目線で切る。";
    const tags = extractTagSet(text);
    expect(tags.has("再開発")).toBe(true);
    expect(tags.has("六本木")).toBe(true);
    expect(tags.has("経営者")).toBe(true);
  });

  it("normalizes tags to lowercase so case-mixed inputs still dedup", () => {
    const text = "Brooklyn の街角で社会風刺、 BROOKLYN の影で再開発を撃つ";
    const tags = extractTagSet(text);
    expect(tags.has("brooklyn")).toBe(true);
    expect(tags.has("社会風刺")).toBe(true);
    expect(tags.has("再開発")).toBe(true);
  });
});
