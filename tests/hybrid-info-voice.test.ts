import { describe, expect, it } from "vitest";
import { formatRuntimeEvent } from "../src/services/telegramNotifier";
import type { CommissionBrief } from "../src/types";
import type { ChangeSetProposal } from "../src/services/freeformChangesetProposer";

function brief(): CommissionBrief {
  return {
    songId: "spawn_9a57b4",
    title: "Backyard Cure",
    brief: "再開発の街の裏側を切る。",
    lyricsTheme: "街が治るふりをする夜",
    mood: "tense, cynical, urgent",
    tempo: "148 BPM",
    duration: "165",
    styleNotes: "distorted bass, dry drums",
    sourceText: "autopilot spawn",
    createdAt: "2026-05-08T00:00:00.000Z"
  };
}

function proposal(): ChangeSetProposal {
  return {
    id: "changeset-song-1",
    domain: "song",
    summary: "fill missing skeleton",
    fields: [],
    warnings: [],
    createdAt: "2026-05-08T00:00:00.000Z",
    source: "commission",
    songId: "song-010"
  };
}

describe("hybrid event info voice formatting", () => {
  it("formats song_spawn_proposed details without raw field labels", async () => {
    const text = await formatRuntimeEvent({
      type: "song_spawn_proposed",
      voiceTop: "ゆずる、再開発の街を切るやつ、刺さる",
      candidateSongId: "spawn_9a57b4",
      brief: brief(),
      reason: "街の剥がれ方が刺さった。低い熱で行く。",
      timestamp: 1
    });

    expect(text).not.toMatch(/- (songId|title|mood|tempo|duration|reason):/);
    expect(text).toContain("『Backyard Cure』");
    expect(text).toContain("テンポは速め");
    expect(text).toContain("緊張感のある3分くらい");
    expect(text).toContain("これで合ってる気がする");
    expect(text).toContain("街の剥がれ方が刺さった。低い熱で行く。");
    expect(text).not.toContain("tense, cynical, urgent");
    expect(text).not.toContain("148 BPM");
  });

  it("formats prompt_pack_ready details as lyrics plus one spoken detail line", async () => {
    const text = await formatRuntimeEvent({
      type: "prompt_pack_ready",
      songId: "song-010",
      title: "Backyard Cure",
      lyricsExcerpt: "街が治るふりをする\nネオンだけが咳をする\nまだ誰も帰れない",
      mood: "cold, suspicious",
      tempo: "148 BPM",
      styleNotes: "Rhodes, sax, dry drums",
      voiceTop: "ゆずるさん、歌詞こんな感じ。Suno 行く?",
      timestamp: 1
    });

    expect(text).not.toMatch(/- (mood|tempo|style):/);
    expect(text).toContain("街が治るふりをする");
    expect(text).toContain("cold, suspicious・148 BPM・Rhodes, sax, dry drums");
  });

  it("formats planning_skeleton_incomplete without machine labels", async () => {
    const text = await formatRuntimeEvent({
      type: "planning_skeleton_incomplete",
      songId: "song-010",
      missing: ["tempo", "duration", "style notes"],
      proposal: proposal(),
      timestamp: 1
    });

    expect(text).not.toContain("Planning skeleton incomplete:");
    expect(text).not.toContain("missing:");
    expect(text).not.toContain("補完案を作った。進めるなら Yes。");
    expect(text.split("─────")[0].trim().length).toBeGreaterThan(0);
    expect(text).toContain("テンポ、長さとstyleを埋める案、出した。これで進めていい?");
  });
});
