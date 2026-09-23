import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composePlanningSkeletonVoice } from "../src/services/planningSkeletonVoiceComposer";

async function workspace(briefBody: string): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-voice-attribution-"));
  await mkdir(join(root, "songs", "song-001"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), "obsessions: 都市の違和感\n", "utf8");
  await writeFile(join(root, "SOUL.md"), "tone: 観察して刺す\n", "utf8");
  await writeFile(join(root, "songs", "song-001", "brief.md"), briefBody, "utf8");
  return root;
}

const URL_PATTERN = /https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d+/;
const AUTHOR_TAG_PATTERN = /@[A-Za-z0-9_]+/;

describe("voice source attribution contract (planning skeleton)", () => {
  it("includes both observation quote and full x.com URL with @author when observation source is available", async () => {
    const root = await workspace([
      "# Brief for song-001",
      "## Direction",
      "- Core theme: 街の声",
      "- Mood: cold, observant",
      "## Observation source",
      "- Path: observations/2026-05-09.md",
      "- Author: city_note",
      "- URL: https://x.com/city_note/status/1234567890123456789",
      "- Quote: 再開発で小さい店がまた消えた"
    ].join("\n"));

    const voice = await composePlanningSkeletonVoice({
      workspaceRoot: root,
      songId: "song-001",
      missing: ["tempo", "duration"]
    });

    expect(voice).toContain("再開発で小さい店");
    expect(voice).toMatch(URL_PATTERN);
    expect(voice).toMatch(AUTHOR_TAG_PATTERN);
    expect(voice).toContain("city_note");
    expect(voice).toContain("https://x.com/city_note/status/1234567890123456789");
  });

  it("does not embed an observation quote when no source is available (fail-soft, no orphan quotes)", async () => {
    const root = await workspace([
      "# Brief for song-001",
      "## Direction",
      "- Core theme: 街の声",
      "- Mood: cold"
    ].join("\n"));

    const voice = await composePlanningSkeletonVoice({
      workspaceRoot: root,
      songId: "song-001",
      missing: ["tempo"]
    });

    const hasOrphanQuote = /[「『][^「『」』]{4,}[」』]/.test(voice) && !URL_PATTERN.test(voice);
    expect(hasOrphanQuote).toBe(false);
  });

  it("never includes short t.co URL in voice (only full x.com URLs are accepted)", async () => {
    const root = await workspace([
      "# Brief for song-001",
      "## Direction",
      "- Core theme: 街の声",
      "## Observation source",
      "- Path: observations/x.md",
      "- Author: city_note",
      "- URL: https://t.co/abc123",
      "- Quote: 再開発で小さい店がまた消えた"
    ].join("\n"));

    const voice = await composePlanningSkeletonVoice({
      workspaceRoot: root,
      songId: "song-001",
      missing: ["tempo"]
    });

    expect(voice).not.toContain("https://t.co/");
    const hasQuoteWithoutFullUrl = voice.includes("再開発") && !URL_PATTERN.test(voice);
    expect(hasQuoteWithoutFullUrl).toBe(false);
  });
});
