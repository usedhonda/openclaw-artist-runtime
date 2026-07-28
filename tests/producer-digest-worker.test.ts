import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace.js";
import { appendRuntimeEvent } from "../src/services/runtimeEventsLedger.js";
import { writeAutopilotRunState } from "../src/services/autopilotService.js";
import {
  composeProducerDigest,
  sendProducerDigestOnce
} from "../src/services/producerDigestWorker.js";
import type { RuntimeEvent } from "../src/services/runtimeEventBus.js";

function telegramOk(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, result: { message_id: 7, chat: { id: 123 }, text: "ok" } })
  } as Response;
}

// Models the intermittent api.telegram.org connect timeout this Mac hits
// (UND_ERR_CONNECT_TIMEOUT / ETIMEDOUT): fetch throws before any HTTP response.
function transientNetworkError(): Error {
  const error = new Error("fetch failed");
  (error as { cause?: unknown }).cause = { code: "ETIMEDOUT" };
  return error;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

// Built from local components so the local-calendar-day key is deterministic
// regardless of the machine timezone the test runs in.
const NOW = new Date(2026, 6, 27, 9, 0, 0);
const SAME_DAY_LATER = new Date(2026, 6, 27, 20, 0, 0);

function takeCompleted(ts: number): Extract<RuntimeEvent, { type: "song_take_completed" }> {
  return { type: "song_take_completed", songId: "song-1", urls: ["u"], timestamp: ts };
}

function hardStop(ts: number): Extract<RuntimeEvent, { type: "suno_hard_stop" }> {
  return { type: "suno_hard_stop", reason: "captcha", timestamp: ts };
}

describe("producer daily digest", () => {
  it("delivers once when mode is daily and no digest was sent today, then dedups the same day", async () => {
    const root = await mkdtemp(join(tmpdir(), "artist-runtime-digest-"));
    await ensureArtistWorkspace(root);
    const fetchImpl = vi.fn().mockResolvedValue(telegramOk());

    const first = await sendProducerDigestOnce({
      root,
      token: "token",
      chatIds: [123],
      mode: "daily",
      fetchImpl,
      now: NOW
    });
    expect(first).toMatchObject({ delivered: true, dateKey: "2026-07-27" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const marker = await readFile(join(root, "runtime", "producer-digest-last-sent.txt"), "utf8");
    expect(marker.trim()).toBe("2026-07-27");

    // Same local day: a gateway bounce / re-tick must not re-send.
    const second = await sendProducerDigestOnce({
      root,
      token: "token",
      chatIds: [123],
      mode: "daily",
      fetchImpl,
      now: SAME_DAY_LATER
    });
    expect(second).toMatchObject({ delivered: false, skipped: "dedup" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not send when the mode is not daily", async () => {
    const root = await mkdtemp(join(tmpdir(), "artist-runtime-digest-mode-"));
    await ensureArtistWorkspace(root);
    const fetchImpl = vi.fn().mockResolvedValue(telegramOk());

    const result = await sendProducerDigestOnce({
      root,
      token: "token",
      chatIds: [123],
      mode: "important_events",
      fetchImpl,
      now: NOW
    });
    expect(result).toMatchObject({ delivered: false, skipped: "mode" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the daily digest even on a fully quiet day (no signal events)", async () => {
    const root = await mkdtemp(join(tmpdir(), "artist-runtime-digest-quiet-"));
    await ensureArtistWorkspace(root);
    const fetchImpl = vi.fn().mockResolvedValue(telegramOk());

    const result = await sendProducerDigestOnce({
      root,
      token: "token",
      chatIds: [123],
      mode: "daily",
      fetchImpl,
      now: NOW
    });
    expect(result.delivered).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("counts only the last 24h of events and reflects run state in the next line", async () => {
    const root = await mkdtemp(join(tmpdir(), "artist-runtime-digest-window-"));
    await ensureArtistWorkspace(root);
    // Two takes inside the window, one blocker inside, and one stale take (older than 24h).
    await appendRuntimeEvent(root, takeCompleted(NOW.getTime() - 60_000));
    await appendRuntimeEvent(root, takeCompleted(NOW.getTime() - 2 * 60 * 60 * 1000));
    await appendRuntimeEvent(root, hardStop(NOW.getTime() - 30 * 60 * 1000));
    await appendRuntimeEvent(root, takeCompleted(NOW.getTime() - 48 * 60 * 60 * 1000));
    await writeAutopilotRunState(root, {
      stage: "suno_generation",
      currentSongId: "song-9",
      paused: false,
      blockedReason: "waiting for Suno result import",
      retryCount: 0,
      cycleCount: 3,
      updatedAt: NOW.toISOString()
    });

    const text = await composeProducerDigest(root, NOW);
    expect(text).toContain("完成したテイク: 2 曲");
    expect(text).toContain("ブロッカー/要対応: 1 件");
    expect(text).toContain("待ち: waiting for Suno result import");
  });

  it("does not abandon the day when a send fails: no marker is written, so the next tick retries and only then dedups", async () => {
    const root = await mkdtemp(join(tmpdir(), "artist-runtime-digest-retry-"));
    await ensureArtistWorkspace(root);
    // Fail fast without backoff sleeps; the intermittent Telegram outage is what we model.
    vi.stubEnv("OPENCLAW_TELEGRAM_RETRY_MAX", "1");
    const markerFile = join(root, "runtime", "producer-digest-last-sent.txt");
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(transientNetworkError())
      .mockResolvedValue(telegramOk());

    // First tick: the send throws. The day is NOT abandoned — no marker is written,
    // so a later tick can retry.
    await expect(
      sendProducerDigestOnce({ root, token: "token", chatIds: [123], mode: "daily", fetchImpl, now: NOW })
    ).rejects.toThrow();
    await expect(readFile(markerFile, "utf8")).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Next tick, same day, network recovered: delivers and records the marker.
    const recovered = await sendProducerDigestOnce({
      root,
      token: "token",
      chatIds: [123],
      mode: "daily",
      fetchImpl,
      now: SAME_DAY_LATER
    });
    expect(recovered).toMatchObject({ delivered: true, dateKey: "2026-07-27" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((await readFile(markerFile, "utf8")).trim()).toBe("2026-07-27");

    // Once delivered, further same-day ticks dedup — exactly one digest per day.
    const dedup = await sendProducerDigestOnce({
      root,
      token: "token",
      chatIds: [123],
      mode: "daily",
      fetchImpl,
      now: SAME_DAY_LATER
    });
    expect(dedup).toMatchObject({ delivered: false, skipped: "dedup" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
