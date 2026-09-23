import { describe, expect, it } from "vitest";

// @ts-expect-error -- importing a .mjs script is fine for vitest's runtime check.
import { buildArtistMd, buildSocialVoiceMd, extractSpotifyProfileSection, parseFrontmatter, splitSections, stripSoundCloudLines } from "../scripts/import-obsidian-artist.mjs";

const SAMPLE = `---
name: "test::artist"
genres: ["hip-hop", "ambient"]
language: "ja"
tempo_range: "120-160"
tags: [artist, suno]
cover: "[[artists/test-cover.png]]"
---

# test::artist

![[test-cover.png]]

## 人物像
社会風刺ラッパー。

## 音楽的ルーツ
- NUジャズ、ブルックリンの空気感

## 声・歌い方
- 中音域ベース

## 歌詞
- テーマ: 社会風刺

## プロダクション
- 生音ドラム

## リスナー
- ターゲット: 知的層

## 出力ルール（全曲共通）
- 言語比率: 日本語80% / 英語20%

## Spotify Profile

### Bio
東京の夜を割るジャズドラム。

### URLs
- Spotify: https://open.spotify.com/artist/example
- SoundCloud: (TBD)
`;

describe("import-obsidian-artist parser", () => {
  it("extracts frontmatter scalar and array values", () => {
    const { frontmatter } = parseFrontmatter(SAMPLE);
    expect(frontmatter.name).toBe("test::artist");
    expect(frontmatter.genres).toEqual(["hip-hop", "ambient"]);
    expect(frontmatter.language).toBe("ja");
    expect(frontmatter.tempo_range).toBe("120-160");
  });

  it("returns the body without the frontmatter", () => {
    const { body } = parseFrontmatter(SAMPLE);
    expect(body).toContain("# test::artist");
    expect(body).not.toContain("name: \"test::artist\"");
  });

  it("splits sections by ## headings", () => {
    const { body } = parseFrontmatter(SAMPLE);
    const sections = splitSections(body);
    expect(sections.has("人物像")).toBe(true);
    expect(sections.has("音楽的ルーツ")).toBe(true);
    expect(sections.has("出力ルール（全曲共通）")).toBe(true);
    expect(sections.has("Spotify Profile")).toBe(true);
    expect(sections.get("人物像")).toContain("社会風刺ラッパー");
  });

  it("builds an ARTIST.md with public identity, sound, and Suno YAML profile", () => {
    const { frontmatter, body } = parseFrontmatter(SAMPLE);
    const sections = splitSections(body);
    const md = buildArtistMd({ frontmatter, sections });
    expect(md).toContain("# ARTIST.md");
    expect(md).toContain("Artist name: test::artist");
    expect(md).toContain("Genre DNA: hip-hop, ambient");
    expect(md).toContain("Tempo bias: 120-160 BPM");
    expect(md).toContain("```yaml");
    expect(md).toContain("name: \"test::artist\"");
    expect(md).toContain("- hip-hop");
    expect(md).toContain("- ambient");
    expect(md).toContain("社会風刺ラッパー");
    expect(md).toContain("生音ドラム");
  });

  it("never emits raw secrets or external link tokens that look like credentials", () => {
    const { frontmatter, body } = parseFrontmatter(SAMPLE);
    const sections = splitSections(body);
    const md = buildArtistMd({ frontmatter, sections });
    expect(md).not.toMatch(/api[_-]?key/i);
    expect(md).not.toMatch(/access[_-]?token/i);
    expect(md).not.toMatch(/cookie/i);
  });

  it("builds a SOCIAL_VOICE.md including imported Spotify section", () => {
    const { body } = parseFrontmatter(SAMPLE);
    const sections = splitSections(body);
    const md = buildSocialVoiceMd({ sections });
    expect(md).toContain("# SOCIAL_VOICE.md");
    expect(md).toContain("Voice");
    expect(md).toContain("Spotify Profile (imported)");
    expect(md).toContain("東京の夜を割るジャズドラム");
    expect(md).toContain("https://open.spotify.com/artist/example");
  });

  it("strips the SoundCloud line during import (move-time filter)", () => {
    const { body } = parseFrontmatter(SAMPLE);
    const sections = splitSections(body);
    const md = buildSocialVoiceMd({ sections });
    expect(md).not.toMatch(/^\s*-\s*SoundCloud\s*:/im);
    expect(md).toContain("https://open.spotify.com/artist/example");
  });

  it("stripSoundCloudLines removes only list-item SoundCloud entries", () => {
    const input = [
      "Some prose mentioning SoundCloud is allowed.",
      "- Spotify: https://example",
      "- SoundCloud: (TBD)",
      "  - SoundCloud: nested also dropped"
    ].join("\n");
    const out = stripSoundCloudLines(input);
    expect(out).toContain("Some prose mentioning SoundCloud is allowed.");
    expect(out).toContain("- Spotify: https://example");
    expect(out).not.toMatch(/^\s*-\s*SoundCloud\s*:/im);
  });

  it("extractSpotifyProfileSection returns body of an existing workspace SOCIAL_VOICE.md", () => {
    const existing = [
      "# SOCIAL_VOICE.md",
      "",
      "## Voice",
      "",
      "Short. Precise.",
      "",
      "## Spotify Profile (imported)",
      "",
      "### Bio",
      "Imported bio line",
      "",
      "### URLs",
      "- Spotify: https://open.spotify.com/artist/manually-edited",
      "- X: https://x.com/test_artist (handle: @test_artist)"
    ].join("\n");
    const extracted = extractSpotifyProfileSection(existing);
    expect(extracted).toContain("Imported bio line");
    expect(extracted).toContain("manually-edited");
    expect(extracted).toContain("@test_artist");
    expect(extracted).not.toContain("## Voice");
  });

  it("extractSpotifyProfileSection returns null when the section is absent", () => {
    const existing = [
      "# SOCIAL_VOICE.md",
      "",
      "## Voice",
      "",
      "Short."
    ].join("\n");
    expect(extractSpotifyProfileSection(existing)).toBeNull();
  });

  it("buildSocialVoiceMd preserves the existing Spotify Profile section when provided (re-import safety)", () => {
    const { body } = parseFrontmatter(SAMPLE);
    const sections = splitSections(body);
    const handcrafted = [
      "### Bio",
      "Manually curated bio in workspace",
      "",
      "### URLs",
      "- Spotify: https://open.spotify.com/artist/REAL_URL",
      "- X: https://x.com/test_artist (handle: @test_artist, bird connector tested)"
    ].join("\n");
    const md = buildSocialVoiceMd({ sections, existingSpotifyProfile: handcrafted });
    expect(md).toContain("Manually curated bio in workspace");
    expect(md).toContain("REAL_URL");
    expect(md).toContain("https://x.com/test_artist");
    expect(md).not.toContain("https://open.spotify.com/artist/example");
  });
});
