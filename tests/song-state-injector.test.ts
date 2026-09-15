import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CommissionBrief } from "../src/types";
import { readAutopilotRunState } from "../src/services/autopilotService";
import { readSongState, updateSongState } from "../src/services/artistState";
import { injectCommissionSong } from "../src/services/songStateInjector";

function brief(songId = "commission_test"): CommissionBrief {
  return {
    songId,
    title: "境界の音",
    brief: "都市の境界線で消えるライブハウスの曲。",
    lyricsTheme: "再開発で見えなくなる音",
    mood: "dub-influenced city pop, urban displacement",
    tempo: "132 BPM",
    styleNotes: "太い bass + jazz drum",
    duration: "4 分",
    sourceText: "producer commission",
    createdAt: "2026-04-29T01:00:00.000Z",
    artistObservation: "消えていく音を見過ごせなかった。",
    sources: [{ kind: "news", url: "https://example.com/live-house", author: "City Desk", quote: "ライブハウスが閉館する" }]
  };
}

describe("song state injector", () => {
  it("bootstraps song files and points autopilot planning at the commission song", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-commission-inject-"));

    const result = await injectCommissionSong(root, brief(), { now: new Date("2026-04-29T01:01:00.000Z") });
    const song = await readSongState(root, "commission_test");
    const autopilot = await readAutopilotRunState(root);

    expect(result).toMatchObject({ songId: "commission_test", stateBootstrapped: true });
    expect(song).toMatchObject({
      title: "境界の音",
      status: "brief",
      observationSummary: {
        author: "City Desk",
        url: "https://example.com/live-house",
        quote: "ライブハウスが閉館する",
        motivation: "消えていく音を見過ごせなかった。"
      }
    });
    expect(autopilot).toMatchObject({ currentSongId: "commission_test", stage: "planning" });
    expect(readFileSync(join(root, "songs", "commission_test", "brief.md"), "utf8")).toContain("太い bass");
    expect(readFileSync(join(root, "songs", "commission_test", "lyrics", "lyrics.v1.md"), "utf8")).toContain("Lyrics seed");
    expect(readFileSync(join(root, "artist", "SONGBOOK.md"), "utf8")).toContain("| commission_test | 境界の音 | brief |");
  });

  it("backs up existing song and autopilot state before reinjecting", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-commission-backup-"));
    await updateSongState(root, "commission_test", { title: "Old", status: "idea", reason: "seed" });
    const first = await injectCommissionSong(root, brief(), { now: new Date("2026-04-29T01:01:00.000Z") });

    await injectCommissionSong(root, { ...brief(), brief: "second pass" }, { now: new Date("2026-04-29T01:02:00.000Z") });

    expect(first.backups.entries.some((entry) => entry.backupPath && existsSync(entry.backupPath))).toBe(true);
  });
});
