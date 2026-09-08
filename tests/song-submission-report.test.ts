import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
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
    const fetchImpl = async (): Promise<Response> => ({
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

  it("attaches the trial audio from the exact run results for song_take_completed", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-telegram-trial-audio-"));
    const runDir = join(root, "runtime", "suno", "run-trial");
    const audioPath = join(runDir, "take.mp3");
    await mkdir(runDir, { recursive: true });
    await writeFile(audioPath, Buffer.from("trial-audio"));
    await mkdir(join(root, "songs", "song-trial", "suno"), { recursive: true });
    await writeFile(join(root, "songs", "song-trial", "suno", "runs.jsonl"), `${JSON.stringify({ runId: "run-trial", songId: "song-trial", createdAt: "2026-01-01T00:00:00.000Z", status: "accepted", urls: ["https://suno.com/song/trial"], dryRun: false })}\n`);
    await writeFile(join(root, "songs", "song-trial", "suno", "run-trial.results.json"), JSON.stringify({ runId: "run-trial", urls: ["https://suno.com/song/trial"], resultRefs: ["runtime/suno/run-trial/take.mp3"] }));
    let messageId = 20;
    const fetchImpl = async (): Promise<Response> => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: messageId++, chat: { id: 123 } } }) } as Response);
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot: root, fetchImpl });
    await notifier.notify({ type: "song_take_completed", songId: "song-trial", urls: ["https://suno.com/song/trial"], timestamp: 1 });
    const receipts = (await readFile(join(root, "runtime", "telegram-deliveries.jsonl"), "utf8")).trim().split("\n");
    expect(receipts).toHaveLength(2);
  });

  it("does not attach a newer run's audio when the completed URLs belong to an older run", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-telegram-trial-run-"));
    await mkdir(join(root, "songs", "song-run", "suno"), { recursive: true });
    await mkdir(join(root, "runtime", "suno", "run-old"), { recursive: true });
    await mkdir(join(root, "runtime", "suno", "run-new"), { recursive: true });
    await writeFile(join(root, "runtime", "suno", "run-old", "old.mp3"), Buffer.from("old"));
    await writeFile(join(root, "runtime", "suno", "run-new", "new.mp3"), Buffer.from("new"));
    await writeFile(join(root, "songs", "song-run", "suno", "runs.jsonl"), [
      { runId: "run-old", songId: "song-run", createdAt: "2026-01-01T00:00:00.000Z", status: "accepted", urls: ["https://suno.com/song/old"], dryRun: false },
      { runId: "run-new", songId: "song-run", createdAt: "2026-01-02T00:00:00.000Z", status: "accepted", urls: ["https://suno.com/song/new"], dryRun: false }
    ].map((run) => JSON.stringify(run)).join("\n"));
    await writeFile(join(root, "songs", "song-run", "suno", "run-old.results.json"), JSON.stringify({ runId: "run-old", urls: ["https://suno.com/song/old"], resultRefs: ["runtime/suno/run-old/old.mp3"] }));
    await writeFile(join(root, "songs", "song-run", "suno", "run-new.results.json"), JSON.stringify({ runId: "run-new", urls: ["https://suno.com/song/new"], resultRefs: ["runtime/suno/run-new/new.mp3"] }));
    let calls = 0;
    const fetchImpl = async (): Promise<Response> => { calls += 1; return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: calls, chat: { id: 123 } } }) } as Response; };
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot: root, fetchImpl });
    await notifier.notify({ type: "song_take_completed", songId: "song-run", urls: ["https://suno.com/song/old"], timestamp: 1 });
    expect(calls).toBe(2);
  });

  it("ignores a run whose later correction record is failed", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-telegram-trial-correction-"));
    await mkdir(join(root, "songs", "song-correction", "suno"), { recursive: true });
    await writeFile(join(root, "songs", "song-correction", "suno", "runs.jsonl"), [
      { runId: "run-correction", songId: "song-correction", createdAt: "2026-01-01T00:00:00.000Z", status: "accepted", urls: ["https://suno.com/song/correction"], dryRun: false },
      { runId: "run-correction", songId: "song-correction", createdAt: "2026-01-01T00:01:00.000Z", status: "failed", urls: ["https://suno.com/song/correction"], dryRun: false }
    ].map((run) => JSON.stringify(run)).join("\n"));
    let calls = 0;
    const fetchImpl = async (): Promise<Response> => { calls += 1; return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: calls, chat: { id: 123 } } }) } as Response; };
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot: root, fetchImpl });
    await notifier.notify({ type: "song_take_completed", songId: "song-correction", urls: ["https://suno.com/song/correction"], timestamp: 1 });
    expect(calls).toBe(1);
  });

  it("uses the immutable historical payload title instead of current song state", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-telegram-historical-title-"));
    const packDir = join(root, "songs", "song-history", "prompts", "prompt-pack-v001");
    await mkdir(packDir, { recursive: true });
    const payload = { songName: "Immutable Historical Title" };
    const payloadHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    await writeFile(join(packDir, "suno-payload.json"), JSON.stringify(payload));
    await writeFile(join(packDir, "metadata.json"), JSON.stringify({ payloadHash }));
    await writeFile(join(packDir, "style.md"), "118 BPM\n");
    await writeFile(join(packDir, "exclude.md"), "noise");
    await mkdir(join(root, "songs", "song-history", "suno"), { recursive: true });
    await writeFile(join(root, "songs", "song-history", "suno", "runs.jsonl"), `${JSON.stringify({ runId: "run-history", songId: "song-history", createdAt: "2026-01-01T00:00:00.000Z", status: "accepted", payloadHash, urls: ["https://suno.com/song/history"], dryRun: false })}\n`);
    const text = await formatRuntimeEvent({ type: "song_take_completed", songId: "song-history", urls: ["https://suno.com/song/history"], timestamp: 1 }, { workspaceRoot: root });
    expect(text).toContain("Immutable Historical Title");
    expect(text).not.toContain("今回の曲を提出する");
  });
});
