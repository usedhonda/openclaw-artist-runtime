import { mkdtempSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maybeSendSilenceRecoveryNotice, readSilenceFlag } from "../src/services/index";

async function setupWorkspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-watchdog-"));
  await mkdir(join(root, "runtime"), { recursive: true });
  return root;
}

async function writeFlag(root: string, epochSeconds: number): Promise<string> {
  const path = join(root, "runtime", "telegram-watchdog-fired-at.txt");
  await writeFile(path, `${epochSeconds}\n`, "utf8");
  return path;
}

async function flagExists(root: string): Promise<boolean> {
  try {
    await readFile(join(root, "runtime", "telegram-watchdog-fired-at.txt"), "utf8");
    return true;
  } catch {
    return false;
  }
}

describe("readSilenceFlag", () => {
  it("returns null when flag file is missing", async () => {
    const root = await setupWorkspace();
    expect(await readSilenceFlag(root)).toBeNull();
  });

  it("returns parsed epoch ms when flag is valid", async () => {
    const root = await setupWorkspace();
    const epochSec = Math.floor(Date.now() / 1000);
    await writeFlag(root, epochSec);
    const result = await readSilenceFlag(root);
    expect(result).not.toBeNull();
    expect(result!.firedAtMs).toBe(epochSec * 1000);
  });

  it("returns null when flag is malformed", async () => {
    const root = await setupWorkspace();
    await writeFile(join(root, "runtime", "telegram-watchdog-fired-at.txt"), "not-a-number\n", "utf8");
    expect(await readSilenceFlag(root)).toBeNull();
  });
});

describe("maybeSendSilenceRecoveryNotice", () => {
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("does nothing when flag file is missing", async () => {
    const root = await setupWorkspace();
    await maybeSendSilenceRecoveryNotice("test-token", [12345], root);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends notice and removes flag when flag is recent and fetch succeeds", async () => {
    const root = await setupWorkspace();
    const recent = Math.floor(Date.now() / 1000) - 60;
    await writeFlag(root, recent);
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    await maybeSendSilenceRecoveryNotice("test-token", [12345], root);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bottest-token/sendMessage");
    const body = JSON.parse((init as { body: string }).body);
    expect(body.chat_id).toBe(12345);
    expect(body.text).toContain("沈黙");
    expect(body.text).toContain("もう一回");
    expect(await flagExists(root)).toBe(false);
  });

  it("removes stale flag (older than 10 min) without sending", async () => {
    const root = await setupWorkspace();
    const stale = Math.floor(Date.now() / 1000) - 11 * 60;
    await writeFlag(root, stale);
    await maybeSendSilenceRecoveryNotice("test-token", [12345], root);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await flagExists(root)).toBe(false);
  });

  it("keeps flag when fetch fails so next process boot retries", async () => {
    const root = await setupWorkspace();
    const recent = Math.floor(Date.now() / 1000) - 30;
    await writeFlag(root, recent);
    fetchMock.mockRejectedValue(new Error("ENETUNREACH"));
    await maybeSendSilenceRecoveryNotice("test-token", [12345], root);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(await flagExists(root)).toBe(true);
  });

  it("keeps flag when fetch returns non-OK status", async () => {
    const root = await setupWorkspace();
    const recent = Math.floor(Date.now() / 1000) - 30;
    await writeFlag(root, recent);
    fetchMock.mockResolvedValue(new Response(null, { status: 502 }));
    await maybeSendSilenceRecoveryNotice("test-token", [12345], root);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(await flagExists(root)).toBe(true);
  });

  it("sends to multiple chat ids and removes flag only when all succeed", async () => {
    const root = await setupWorkspace();
    const recent = Math.floor(Date.now() / 1000) - 30;
    await writeFlag(root, recent);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await maybeSendSilenceRecoveryNotice("test-token", [12345, 67890], root);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await flagExists(root)).toBe(true);
  });

  it("ignores future-timestamped flags as malformed (clock skew defense)", async () => {
    const root = await setupWorkspace();
    const future = Math.floor(Date.now() / 1000) + 600;
    await writeFlag(root, future);
    await maybeSendSilenceRecoveryNotice("test-token", [12345], root);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await flagExists(root)).toBe(false);
  });
});
