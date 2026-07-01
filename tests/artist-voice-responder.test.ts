import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPrompt, generateArtistResponse, readArtistVoiceContext } from "../src/services/artistVoiceResponder";

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-voice-"));
}

async function writeVoiceFixture(root: string): Promise<void> {
  await mkdir(join(root, "artist"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), "# ARTIST.md\n\nArtist name: Ghost Relay\n\n## Current artist core\n\n- Core obsessions: 社会風刺\n\n## Sound\n\nCold station pop.\n\n## Places\n\n渋谷\n", "utf8");
  await writeFile(join(root, "SOUL.md"), "# SOUL.md\n\nConversation tone: short, direct, ash-road loyal.\n\n- Emotional weather: late train pressure\n", "utf8");
  await writeFile(join(root, "artist", "CURRENT_STATE.md"), "# CURRENT_STATE.md\n\n- Emotional weather: Watching late trains.\n", "utf8");
  await writeFile(join(root, "artist", "SOCIAL_VOICE.md"), "# SOCIAL_VOICE.md\n\nNo sales pitch.\n", "utf8");
}

describe("artist voice responder", () => {
  it("generates a persona-flavored mock response from context files", async () => {
    const root = makeRoot();
    await writeVoiceFixture(root);
    const context = await readArtistVoiceContext(root, { recentHistory: ["user: what are we making?"] });

    const response = await generateArtistResponse("次の曲どうする?", context, { intent: "discuss" });

    expect(response.text).toMatch(/社会風刺|渋谷/);
    expect(response.text).not.toContain("I heard this:");
    expect(response.text).not.toContain("次の曲どうする");
    expect(response.suggestedActions).toContain("keep_discussing");
  });

  it("injects the persona motif anchor into the AI prompt", async () => {
    const root = makeRoot();
    await writeVoiceFixture(root);
    const context = await readArtistVoiceContext(root);
    const prompt = buildPrompt("聴いた", context, "discuss");

    expect(prompt).toContain("Persona motifs (anchor):");
    expect(prompt).toMatch(/themes:.*社会風刺/);
    expect(prompt).toContain("渋谷");
  });

  it("builds a two-layer prompt with voice contract index plus full persona body", async () => {
    const root = makeRoot();
    await writeVoiceFixture(root);
    await writeFile(
      join(root, "SOUL.md"),
      [
        "# SOUL.md - Who I Am",
        "",
        "_俺は AI 助手じゃない。test artist だ。_",
        "",
        "## My Heart",
        "テスト用の心。何を作るか書く場所。" .repeat(4),
        "",
        "## Core Truths",
        "### 1. 事実を述べるな",
        "景色で切る。",
        "",
        "## Internal Tensions",
        "テストの矛盾を 80 字以上で書く必要があるからこの行で長さを稼ぐ。" .repeat(2),
        "",
        "## Boundaries",
        "- 個人攻撃はやらない",
        "**優先順位**: Boundaries > 真実性 > 美学 > Vibe",
        "",
        "## What I'm Not",
        "養殖魚じゃない。会社員ラッパーじゃない。",
        "",
        "## The Vibe",
        "乾いた皮肉。",
        "",
        "### Signature Moves",
        '- "聴いた。"',
        '- "ゆずるさん、これ刺さるか?"',
        '- "止まった。"',
        '- "別案がある。"',
        '- "今夜はこれで。"',
        "",
        "## 文体 variation rule",
        "",
        "### forbidden_phrases",
        '- "了解しました"',
        '- "申し訳ございません"',
        '- "ご確認ください"',
        "",
        "### sentence_endings",
        '- "。"',
        '- "だ。"',
        "",
        "### reaction_phrases",
        '- "わかる"',
        '- "刺さる"',
        "",
        "## Producer (relationship in music-making)",
        "ゆずるさんに draft を投げる。先に聴かせる相手。長くやってる。",
        "",
        "### Producer call",
        "- producer_callname: ゆずるさん",
        "- first_person: 俺",
        "",
        "## Continuity",
        "毎セッション新しく目覚める。"
      ].join("\n"),
      "utf8"
    );
    await writeFile(join(root, "IDENTITY.md"), "# IDENTITY.md\n\nmanual stale identity\n", "utf8");
    await writeFile(join(root, "INNER.md"), "# INNER.md\n揺らぎの記録。\n", "utf8");
    await writeFile(join(root, "PRODUCER.md"), "# PRODUCER.md\n- Name: Yuzuru Honda\n", "utf8");

    const context = await readArtistVoiceContext(root);
    const physicalIdentity = await readFile(join(root, "IDENTITY.md"), "utf8");
    const legacyManifest = await readFile(join(root, "runtime", "persona-legacy", "manifest.jsonl"), "utf8");
    const prompt = buildPrompt("聴いた", context, "discuss");

    // Layer 1: Voice Contract index
    expect(prompt).toContain("Voice Contract");
    expect(prompt).toContain('Producer is addressed as "ゆずるさん"');
    expect(prompt).toContain('First-person: "俺"');
    expect(prompt).toContain("Allowed sentence endings:");
    expect(prompt).toContain("Forbidden phrases (NEVER output):");
    expect(prompt).toContain("Sample voice (the ONLY way to sound):");
    expect(prompt).toContain("If you cannot match this voice, return empty string");

    // Layer 2: Full persona body inject (5 file)
    expect(prompt).toContain("===== SOUL.md =====");
    expect(prompt).toContain("===== ARTIST.md =====");
    expect(prompt).toContain("===== IDENTITY.md =====");
    expect(prompt).toContain("Derived identity card. Do not edit directly.");
    expect(prompt).not.toContain("manual stale identity");
    expect(prompt).toContain("===== INNER.md =====");
    expect(prompt).toContain("===== PRODUCER.md =====");
    expect(prompt).toContain("揺らぎの記録");
    expect(prompt).toContain("Yuzuru Honda");
    expect(physicalIdentity).toBe(context.identityMd);
    expect(legacyManifest).toContain("artist_voice_identity_projection_sync");
  });

  it("blocks secret-like user input and secret-like context", async () => {
    const root = makeRoot();
    await writeVoiceFixture(root);
    const context = await readArtistVoiceContext(root);
    await expect(generateArtistResponse("API_KEY=do-not-store", context, { intent: "discuss" }))
      .rejects.toThrow("user_message_contains_secret_like_text");

    await expect(generateArtistResponse("hello", { ...context, artistMd: "COOKIE=do-not-store" }, { intent: "discuss" }))
      .rejects.toThrow("artist_context_contains_secret_like_text");
  });
});
