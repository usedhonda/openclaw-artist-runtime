import { describe, expect, it } from "vitest";
import { formatRuntimeEvent } from "../src/services/telegramNotifier";
import { formatSongSubmissionReport } from "../src/services/songSubmissionReport";

describe("song submission report", () => {
  it("reports a producer revision without pretending to have heard it", () => {
    const text = formatSongSubmissionReport({
      kind: "submission",
      title: "夜の継ぎ目",
      requestOrVersion: "サビを短くして、前のテイクの冷たさは残す / v2",
      origin: "producer_revision",
      binding: { runId: "run-secret-id", payloadHash: "hash-secret", packVersion: 2, revisionId: "revision-secret" },
      intended: ["サビを短くする"],
      changed: ["2番からサビへ戻るまでを詰めた"],
      kept: ["冷たい声の距離感"],
      audioUrls: ["https://suno.com/song/new"],
      previous: { label: "前のテイク", audioUrls: ["https://suno.com/song/old"] },
      listenFor: ["サビが急ぎ足になりすぎていないか"],
      nextFeedback: "聴いて、サビの長さだけ先に返して。"
    });

    expect(text).toContain("夜の継ぎ目");
    expect(text).toContain("変えたところ:");
    expect(text).toContain("残したところ:");
    expect(text).toContain("https://suno.com/song/new");
    expect(text).toContain("https://suno.com/song/old");
    expect(text).toContain("音の確認はまだ");
    expect(text).not.toContain("run-secret-id");
    expect(text).not.toContain("songId");
    expect(text).not.toContain("draft");
  });

  it("keeps URL-ready progress distinct from a completed submission", () => {
    const text = formatSongSubmissionReport({
      kind: "progress",
      title: "まだ途中",
      audioUrls: ["https://suno.com/song/progress"]
    });

    expect(text).toContain("まだ生成中");
    expect(text).toContain("https://suno.com/song/progress");
    expect(text).not.toContain("変えたところ:");
    expect(text).not.toContain("採用か破棄");
  });

  it("does not expose download paths in a download-only update", () => {
    const text = formatSongSubmissionReport({
      kind: "download",
      title: "受取済み",
      audioUrls: ["https://suno.com/song/download"],
      nextFeedback: "音量差だけ比べて教えて。"
    });

    expect(text).toContain("音源を受け取った");
    expect(text).toContain("音量差だけ比べて教えて。");
    expect(text).not.toContain("runtime/");
    expect(text).not.toContain("paths");
    expect(text).not.toContain("完成報告じゃなく");
  });

  it("uses the bounded report for the notifier's URL-ready event", async () => {
    const text = await formatRuntimeEvent({
      type: "suno_take_url_ready",
      songId: "song-internal",
      runId: "run-internal",
      urls: ["https://suno.com/song/ready"],
      timestamp: 1
    });

    expect(text).toContain("まだ生成中");
    expect(text).toContain("https://suno.com/song/ready");
    expect(text).not.toContain("song-internal");
    expect(text).not.toContain("run-internal");
    expect(text).not.toContain("現在地:");
  });
});
