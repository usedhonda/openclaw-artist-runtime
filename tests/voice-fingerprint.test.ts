import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composePlanningSkeletonVoice } from "../src/services/planningSkeletonVoiceComposer";

async function workspace(briefBody: string): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-voice-fingerprint-"));
  await mkdir(join(root, "songs", "song-001"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), "obsessions: 都市の違和感\n", "utf8");
  await writeFile(join(root, "SOUL.md"), "tone: 観察して刺す\n", "utf8");
  await writeFile(join(root, "songs", "song-001", "brief.md"), briefBody, "utf8");
  return root;
}

const SELF_DOUBT_MARKERS = [
  "気がする",
  "合ってる",
  "言えるかな",
  "ずっと抱えて",
  "捨てよう",
  "うまく",
  "わからない"
];

const PRODUCER_INVITATION_MARKERS = [
  "ねえ",
  "どう?",
  "どうかな",
  "来て",
  "委ね",
  "進めていい",
  "通すか",
  "行ってよし",
  "聴いてみて",
  "いっしょに",
  "一緒に"
];

const RELATION_TIME_MARKERS = [
  "信頼",
  "友人",
  "拒絶",
  "委ね",
  "捕まえ",
  "捨てよう",
  "抱えて",
  "逆を行く",
  "半年",
  "一晩",
  "ずっと",
  "今日",
  "今朝"
];

function hasAny(text: string, markers: string[]): boolean {
  return markers.some((marker) => text.includes(marker));
}

describe("voice fingerprint contract (planning skeleton, Phase B inspiration patterns)", () => {
  it("includes at least one of: self-doubt / producer-invitation / relation-time marker", async () => {
    const root = await workspace([
      "# Brief for song-001",
      "## Direction",
      "- Core theme: 街の声",
      "- Mood: cold, observant",
      "## Observation source",
      "- Author: city_note",
      "- URL: https://x.com/city_note/status/1234567890123456789",
      "- Quote: 再開発で小さい店がまた消えた"
    ].join("\n"));

    const voice = await composePlanningSkeletonVoice({
      workspaceRoot: root,
      songId: "song-001",
      missing: ["tempo", "duration"]
    });

    const matched =
      hasAny(voice, SELF_DOUBT_MARKERS) ||
      hasAny(voice, PRODUCER_INVITATION_MARKERS) ||
      hasAny(voice, RELATION_TIME_MARKERS);
    expect(matched).toBe(true);
  });

  it("does not leak builder-view phrases (parse / build / field / motif anchor / themes:)", async () => {
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

    expect(voice).not.toMatch(/parse|build|field|config|runtime|mock/i);
    expect(voice).not.toContain("motif anchor:");
    expect(voice).not.toContain("themes:");
    expect(voice).not.toContain("geo:");
    expect(voice).not.toContain("vocab:");
    expect(voice).not.toContain("sound:");
  });

  it("does not leak file names (ARTIST.md / SOUL.md / INNER.md / PRODUCER.md / IDENTITY.md)", async () => {
    const root = await workspace([
      "# Brief for song-001",
      "## Direction",
      "- Core theme: 街の声"
    ].join("\n"));

    const voice = await composePlanningSkeletonVoice({
      workspaceRoot: root,
      songId: "song-001",
      missing: ["tempo"]
    });

    expect(voice).not.toContain("ARTIST.md");
    expect(voice).not.toContain("SOUL.md");
    expect(voice).not.toContain("INNER.md");
    expect(voice).not.toContain("PRODUCER.md");
    expect(voice).not.toContain("IDENTITY.md");
  });

  it("does not leak placeholder values (TBD / 未定 / todo / fixme / none / n/a)", async () => {
    const root = await workspace([
      "# Brief for song-001",
      "## Direction",
      "- Core theme: TBD",
      "- Mood: 未定"
    ].join("\n"));

    const voice = await composePlanningSkeletonVoice({
      workspaceRoot: root,
      songId: "song-001",
      missing: ["tempo"]
    });

    expect(voice).not.toContain("TBD");
    expect(voice).not.toContain("未定");
    expect(voice).not.toMatch(/\btodo\b/i);
    expect(voice).not.toMatch(/\bfixme\b/i);
    expect(voice).not.toMatch(/\bnone\b/i);
    expect(voice).not.toMatch(/\bn\/a\b/i);
  });

  it("does not leak builder verbs (に基づき / に従い / を変換 / を生成 / 基礎人格 / 基礎トーン)", async () => {
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

    expect(voice).not.toContain("に基づき");
    expect(voice).not.toContain("に従い");
    expect(voice).not.toContain("を変換");
    expect(voice).not.toContain("を生成");
    expect(voice).not.toContain("基礎人格");
    expect(voice).not.toContain("基礎トーン");
    expect(voice).not.toContain("基礎理性");
    expect(voice).not.toContain("基礎商業");
  });
});
