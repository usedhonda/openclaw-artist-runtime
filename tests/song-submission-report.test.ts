import { describe, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatRuntimeEvent } from "../src/services/telegramNotifier";
import { TelegramNotifier } from "../src/services/telegramNotifier";
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

  it("uploads only a verified run-bound audio file and records its Telegram message id", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-telegram-audio-"));
    const audioPath = join(root, "runtime", "suno", "run-audio", "take.mp3");
    await mkdir(join(root, "runtime", "suno", "run-audio"), { recursive: true });
    await writeFile(audioPath, Buffer.from("valid-audio"));
    let messageId = 10;
    const fetchImpl = async (input: string): Promise<Response> => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: messageId++, chat: { id: 123 } } })
    } as Response);
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot: root, fetchImpl });
    await notifier.notify({
      type: "suno_adoption_download_imported",
      songId: "song-audio",
      runId: "run-audio",
      urls: ["https://suno.com/song/audio"],
      paths: ["runtime/suno/run-audio/take.mp3"],
      timestamp: 1
    });
    const receipts = (await readFile(join(root, "runtime", "telegram-deliveries.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as { messageId: number });
    expect(receipts.map((receipt) => receipt.messageId)).toEqual([10, 11]);
  });

  it("falls back to the URL when an audio path is outside the workspace", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-telegram-audio-safe-"));
    let calls = 0;
    const fetchImpl = async (): Promise<Response> => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1, chat: { id: 123 } } }) } as Response;
    };
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot: root, fetchImpl });
    await notifier.notify({
      type: "suno_adoption_download_imported",
      songId: "song-safe",
      runId: "run-safe",
      urls: ["https://suno.com/song/safe"],
      paths: ["/etc/passwd"],
      timestamp: 1
    });
    expect(calls).toBe(1);
  });
});
