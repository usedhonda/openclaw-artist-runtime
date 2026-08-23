import { describe, expect, it } from "vitest";
import {
  LYRICS_KNOWLEDGE_DIGEST_FILES,
  LYRICS_WRITER_SYSTEM_PROMPT,
  SELECTIVE_BLOCK_END,
  SELECTIVE_BLOCK_START,
  buildLyricsDraftingPrompt,
  readLyricsKnowledgeDigest
} from "../src/services/lyricsDraftingPrompt";
import type { CreativeDecision } from "../src/types";

// Persona with a distinct, unique noun per lens bank plus a tag-technique
// section, so a selective-injection test can prove that only the chosen lens's
// bank surfaces in the directive block.
const SELECTIVE_PERSONA = [
  "# Artist",
  "",
  "### Shibuya Tag Techniques",
  "- 技法の扱い(前書き): 渋谷を貼れる住所として扱う。",
  "- 産地表示: 製造元、渋谷と刻印する。",
  "- 診断名: 診断、渋谷と名付ける。",
  "",
  "### Consumption & Face Material Bank",
  "- 整形広告で埋まる駅: 顔のカタログ。",
  "",
  "### Net & Generation Material Bank",
  "- 炎上の賞味期限ネット固有語: 三日で在庫になる怒り。",
  "",
  "### Shibuya Diss Material Bank",
  "- 再開発で消える路地都市固有語: 誰のための通りか。"
].join("\n");

function decisionFixture(overrides: Partial<CreativeDecision> = {}): CreativeDecision {
  return {
    version: 1,
    songId: "song-777",
    decidedAt: "2026-08-23T00:00:00.000Z",
    seed: "song-777\n2026-08-23\nhttps://x.com/a/status/1",
    lens: "consumption_face",
    lensMaterial: ["整形広告で埋まる駅"],
    attackStance: "伝票の暴露（原価と単価の差を読み上げる）",
    emotionalMode: { label: "本気 Dis", spec: "confrontational rap diss" },
    aggression: "dis",
    tempo: { band: "up", bpm: 122 },
    dopagaki: { active: false, threshold: 0.4, variationSeed: "spacious:song-777:0.5" },
    intro: { archetype: "scene_set", modifier: "4 bars, sparse scene", lyricInstruction: "0-1 line", styleMove: "sparse scene intro" },
    hookShape: "number",
    shibuyaTag: "産地表示",
    signature: ["値段の裏側", "数字で読む癖"],
    observation: null,
    degradedInputs: [],
    vocalGender: "male",
    ...overrides
  };
}

function selectiveBlock(prompt: string): string {
  const start = prompt.indexOf(SELECTIVE_BLOCK_START);
  const end = prompt.indexOf(SELECTIVE_BLOCK_END);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return prompt.slice(start, end + SELECTIVE_BLOCK_END.length);
}

describe("lyrics drafting prompt", () => {
  it("embeds the attributed lyrics-writer instructions and expanded knowledge references", async () => {
    const prompt = buildLyricsDraftingPrompt({
      artistMd: "artist",
      currentState: "state",
      briefText: "brief",
      title: "Civic Dread",
      knowledgeDigest: "digest"
    });

    expect(LYRICS_WRITER_SYSTEM_PROMPT).toContain("韻");
    expect(LYRICS_WRITER_SYSTEM_PROMPT).toContain("伏線");
    expect(LYRICS_WRITER_SYSTEM_PROMPT).toContain("情景");
    expect(LYRICS_WRITER_SYSTEM_PROMPT).toContain("パターンA");
    expect(LYRICS_WRITER_SYSTEM_PROMPT).toContain("MIT");
    expect(prompt).toContain("rap_and_flow.md");
    expect(prompt).toContain("english_lyrics.md");
    expect(prompt).toContain("master_reference.md");
    expect(LYRICS_KNOWLEDGE_DIGEST_FILES).toContain("master_reference.md");

    const digest = await readLyricsKnowledgeDigest();
    expect(digest).toContain("## rap_and_flow.md");
    expect(digest).toContain("## english_lyrics.md");
    expect(digest).toContain("## master_reference.md");
  });

  it("injects the persona critique lens and bounded dopagaki mode", () => {
    const activePrompt = buildLyricsDraftingPrompt({
      artistMd: "## Artist Core\n渋谷への怒り。対象は人でなく都市の仕組み。",
      currentState: "",
      briefText: [
        "## Direction",
        "- Lyrics theme: ニュースを渋谷の再開発へ折り返す",
        "## Frozen sources",
        "- news: https://example.test/news — 便利さが安全を薄める",
        "- x_reaction: https://x.com/city/status/123 — 限界だと思う"
      ].join("\n"),
      title: "Shibuya Ledger",
      knowledgeDigest: "",
      dopagakiVariation: {
        active: true,
        intensity: "overt",
        score: 0.1,
        threshold: 0.4,
        variationSeed: "dopagaki:overt:test"
      }
    });
    const inactivePrompt = buildLyricsDraftingPrompt({
      artistMd: "## Artist Core\n渋谷への怒り。",
      currentState: "",
      briefText: "brief",
      title: "Plain Ledger",
      knowledgeDigest: "",
      dopagakiVariation: {
        active: false,
        intensity: "off",
        score: 0.8,
        threshold: 0.4,
        variationSeed: "spacious:test"
      }
    });

    expect(activePrompt).toContain("Critique lens");
    expect(activePrompt).toContain("Do not attack private individuals");
    expect(activePrompt).toContain("High-velocity progressive rap: ACTIVE / OVERT");
    expect(activePrompt).toContain("2-4 bar bursts");
    expect(activePrompt).toContain("Keep live breakbeat jazz drums, thick electric bass, Rhodes");
    expect(inactivePrompt).toContain("core motion is always active; overt density mode is inactive");
    expect(inactivePrompt).toContain("rapid section development");
    expect(inactivePrompt).not.toContain("default spacious rap pacing");
  });

  it("keeps live-sized persona rules and truncates only before a section", () => {
    const artistMd = [
      `## Artist Core\n${"核".repeat(4100)}`,
      "## Avoid\n- 既存曲の焼き直しをしない。",
      "## Anti-mannerism\n- 決まり文句で感情を説明しない。",
      "### Signature section logic\n- フックはヴァースの景色を反転して回収する。"
    ].join("\n\n").padEnd(10871, "余") + `\n\n## Overflow\n${"溢".repeat(1800)}`;

    const prompt = buildLyricsDraftingPrompt({
      artistMd,
      currentState: "",
      briefText: "brief",
      title: "Persona Rules",
      knowledgeDigest: ""
    });

    expect(prompt).toContain("## Avoid");
    expect(prompt).toContain("## Anti-mannerism");
    expect(prompt).toContain("### Signature section logic");
    expect(prompt).toContain("[… persona truncated at section boundary …]");
    expect(prompt).not.toContain("## Overflow");
  });
});

describe("lyrics drafting prompt — selective injection (F2)", () => {
  it("injects ONLY the chosen lens's bank nouns in the directive block", () => {
    const prompt = buildLyricsDraftingPrompt({
      artistMd: SELECTIVE_PERSONA,
      currentState: "",
      briefText: "brief",
      title: "Ledger",
      knowledgeDigest: "",
      decision: decisionFixture()
    });
    const block = selectiveBlock(prompt);

    // Chosen lens (consumption_face) material present in the block.
    expect(block).toContain("整形広告で埋まる駅");
    expect(block).toContain("主レンズ: 消費と顔（A）");
    // Other banks' distinctive nouns must NOT appear inside the directive block,
    // even though the raw ARTIST.md dump later in the prompt still contains them.
    expect(block).not.toContain("ネット固有語");
    expect(block).not.toContain("都市固有語");
    expect(prompt).toContain("ネット固有語"); // raw dump keeps the full persona
  });

  it("injects the full tag-technique bullet, signature, hook shape, and stance", () => {
    const prompt = buildLyricsDraftingPrompt({
      artistMd: SELECTIVE_PERSONA,
      currentState: "",
      briefText: "brief",
      title: "Ledger",
      knowledgeDigest: "",
      decision: decisionFixture()
    });
    const block = selectiveBlock(prompt);

    expect(block).toContain("渋谷タグ技法: 産地表示: 製造元、渋谷と刻印する。");
    expect(block).toContain("値段の裏側 / 数字で読む癖");
    expect(block).toContain("フック形: number — 数字で殴る");
    expect(block).toContain("攻め筋: 伝票の暴露（原価と単価の差を読み上げる）");
    // Safety line must remain in every prompt.
    expect(block).toContain("実名個人と属性は撃たない");
    expect(block).toContain("Do not attack private individuals");
  });

  it("falls back to the tag id alone when the technique section is absent", () => {
    const prompt = buildLyricsDraftingPrompt({
      artistMd: "# Artist\n(no tag section)",
      currentState: "",
      briefText: "brief",
      title: "Ledger",
      knowledgeDigest: "",
      decision: decisionFixture({ shibuyaTag: "住民登録" })
    });
    expect(selectiveBlock(prompt)).toContain("渋谷タグ技法: 住民登録");
  });

  it("emits hard dis directives for aggression=dis", () => {
    const prompt = buildLyricsDraftingPrompt({
      artistMd: SELECTIVE_PERSONA,
      currentState: "",
      briefText: "brief",
      title: "Ledger",
      knowledgeDigest: "",
      decision: decisionFixture({ aggression: "dis" })
    });
    const block = selectiveBlock(prompt);

    expect(block).toContain("攻撃性: 本気 Dis");
    expect(block).toContain("各 verse に punchline を最低2本");
    expect(block).toContain("免罪句禁止");
    expect(block).toContain("スラング歓迎");
  });

  it("keeps the blade for aggression=changeup with the same punchline duty", () => {
    const prompt = buildLyricsDraftingPrompt({
      artistMd: SELECTIVE_PERSONA,
      currentState: "",
      briefText: "brief",
      title: "Ledger",
      knowledgeDigest: "",
      decision: decisionFixture({
        aggression: "changeup",
        emotionalMode: { label: "自嘲", spec: "self-mocking" }
      })
    });
    const block = selectiveBlock(prompt);

    expect(block).toContain("攻撃性: 変化球");
    expect(block).toContain("皮肉の刃は常駐");
    expect(block).toContain("punchline 義務は Dis と同じ");
    expect(block).toContain("免罪句禁止");
  });

  it("keeps the legacy critique-lens prose when no decision is passed", () => {
    const prompt = buildLyricsDraftingPrompt({
      artistMd: SELECTIVE_PERSONA,
      currentState: "",
      briefText: "brief",
      title: "Ledger",
      knowledgeDigest: ""
    });
    expect(prompt).toContain("Critique lens");
    expect(prompt).not.toContain(SELECTIVE_BLOCK_START);
  });
});

describe("lyrics drafting prompt — catchphrase budget", () => {
  it("renders allowed and banned catchphrase names when the previous song used some", () => {
    const prompt = buildLyricsDraftingPrompt({
      artistMd: SELECTIVE_PERSONA,
      currentState: "",
      briefText: "brief",
      title: "Ledger",
      knowledgeDigest: "",
      decision: decisionFixture({
        catchphraseBudget: { allowed: ["donki", "same_same"], banned: ["zenin_shibuya"] }
      })
    });
    const block = selectiveBlock(prompt);
    expect(block).toContain("決め句の予算: 今回使ってよい=ドンキ/免税袋・same X, same Y の定型");
    expect(block).toContain("今回は使わない=全員渋谷（前の曲で使った）");
  });

  it("says 今回は制限なし when nothing was banned", () => {
    const prompt = buildLyricsDraftingPrompt({
      artistMd: SELECTIVE_PERSONA,
      currentState: "",
      briefText: "brief",
      title: "Ledger",
      knowledgeDigest: "",
      decision: decisionFixture({
        catchphraseBudget: { allowed: ["zenin_shibuya", "donki", "same_same"], banned: [] }
      })
    });
    const block = selectiveBlock(prompt);
    expect(block).toContain("決め句の予算: 今回使ってよい=全員渋谷・ドンキ/免税袋・same X, same Y の定型 / 今回は制限なし");
  });

  it("renders 使ってよい=なし when every catchphrase is banned", () => {
    const prompt = buildLyricsDraftingPrompt({
      artistMd: SELECTIVE_PERSONA,
      currentState: "",
      briefText: "brief",
      title: "Ledger",
      knowledgeDigest: "",
      decision: decisionFixture({
        catchphraseBudget: { allowed: [], banned: ["zenin_shibuya", "donki", "same_same"] }
      })
    });
    const block = selectiveBlock(prompt);
    expect(block).toContain("決め句の予算: 今回使ってよい=なし");
    expect(block).toContain("今回は使わない=全員渋谷・ドンキ/免税袋・same X, same Y の定型（前の曲で使った）");
  });

  it("omits the budget line for a legacy decision without a catchphraseBudget", () => {
    const prompt = buildLyricsDraftingPrompt({
      artistMd: SELECTIVE_PERSONA,
      currentState: "",
      briefText: "brief",
      title: "Ledger",
      knowledgeDigest: "",
      decision: decisionFixture()
    });
    expect(prompt).not.toContain("決め句の予算");
  });
});
