import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readReceiveHealth,
  stampCallback,
  stampInbound,
  telegramReceiveHealthPath
} from "../src/services/receiveHealthService";

describe("receive health service (Plan v10.65 Layer 1)", () => {
  it("returns epoch-zero default when no record exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-receive-empty-"));
    const health = await readReceiveHealth(root);
    expect(health.lastInboundAt).toBeUndefined();
    expect(health.lastCallbackAt).toBeUndefined();
    expect(health.updatedAt).toBe(new Date(0).toISOString());
  });

  it("stamps inbound text and persists it atomically", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-receive-inbound-"));
    const now = 1_800_000_000_000;
    await stampInbound(root, now);
    const health = await readReceiveHealth(root);
    expect(health.lastInboundAt).toBe(now);
    expect(health.lastCallbackAt).toBeUndefined();
    const onDisk = JSON.parse(readFileSync(telegramReceiveHealthPath(root), "utf8"));
    expect(onDisk.lastInboundAt).toBe(now);
  });

  it("stamps callback without clobbering the inbound timestamp", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-receive-merge-"));
    const inboundAt = 1_800_000_000_000;
    const callbackAt = 1_800_000_050_000;
    await stampInbound(root, inboundAt);
    await stampCallback(root, callbackAt);
    const health = await readReceiveHealth(root);
    expect(health.lastInboundAt).toBe(inboundAt);
    expect(health.lastCallbackAt).toBe(callbackAt);
  });

  it("does NOT fabricate a healthy/stale verdict (raw timestamps only)", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-receive-noverdict-"));
    await stampInbound(root, 1_800_000_000_000);
    const onDisk = JSON.parse(readFileSync(telegramReceiveHealthPath(root), "utf8"));
    expect(Object.keys(onDisk).sort()).toEqual(["lastInboundAt", "updatedAt"]);
    expect(onDisk).not.toHaveProperty("status");
    expect(onDisk).not.toHaveProperty("healthy");
    expect(onDisk).not.toHaveProperty("verdict");
  });
});
