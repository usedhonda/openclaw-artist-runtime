import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveReplyTarget } from "../src/connectors/social/resolveReplyTarget.js";

const originalTcoFetchEnabled = process.env.OPENCLAW_X_TCO_FETCH_ENABLED;

afterEach(() => {
  if (originalTcoFetchEnabled === undefined) {
    delete process.env.OPENCLAW_X_TCO_FETCH_ENABLED;
  } else {
    process.env.OPENCLAW_X_TCO_FETCH_ENABLED = originalTcoFetchEnabled;
  }
  vi.unstubAllGlobals();
});

describe("resolveReplyTarget", () => {
  it("extracts an X status ID from a URL", async () => {
    await expect(resolveReplyTarget({ targetUrl: "https://x.com/ghost/status/1234567890" })).resolves.toEqual({
      ok: true,
      targetId: "1234567890",
      resolvedFrom: "https://x.com/ghost/status/1234567890"
    });
  });

  it("accepts a bare numeric target ID", async () => {
    await expect(resolveReplyTarget({ targetId: "9876543210" })).resolves.toEqual({
      ok: true,
      targetId: "9876543210",
      resolvedFrom: "targetId"
    });
  });

  it("rejects an empty target", async () => {
    await expect(resolveReplyTarget({})).resolves.toEqual({
      ok: false,
      reason: "reply_target_missing"
    });
  });

  it("expands t.co through an injected fetch implementation only", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      url: "https://twitter.com/ghost/status/5555555555",
      headers: new Headers()
    });

    await expect(resolveReplyTarget({ targetUrl: "https://t.co/abc123" }, { fetchImpl })).resolves.toEqual({
      ok: true,
      targetId: "5555555555",
      resolvedFrom: "https://t.co/abc123"
    });
    expect(fetchImpl).toHaveBeenCalledWith("https://t.co/abc123");
  });

  it("keeps t.co expansion disabled by default without an injected fetch", async () => {
    delete process.env.OPENCLAW_X_TCO_FETCH_ENABLED;

    await expect(resolveReplyTarget({ targetUrl: "https://t.co/abc123" })).resolves.toEqual({
      ok: false,
      reason: "reply_target_tco_requires_fetch",
      resolvedFrom: "https://t.co/abc123"
    });
  });

  it("expands t.co through global fetch only when explicitly enabled", async () => {
    process.env.OPENCLAW_X_TCO_FETCH_ENABLED = "1";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      url: "https://x.com/ghost/status/7777777777",
      headers: new Headers()
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveReplyTarget({ targetUrl: "https://t.co/abc123" })).resolves.toEqual({
      ok: true,
      targetId: "7777777777",
      resolvedFrom: "https://t.co/abc123"
    });
    expect(fetchMock).toHaveBeenCalledWith("https://t.co/abc123", { redirect: "follow" });
  });

  it("fails closed when t.co expansion returns a non-ok response", async () => {
    process.env.OPENCLAW_X_TCO_FETCH_ENABLED = "1";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      url: "https://t.co/abc123",
      headers: new Headers()
    }));

    await expect(resolveReplyTarget({ targetUrl: "https://t.co/abc123" })).resolves.toEqual({
      ok: false,
      reason: "reply_target_tco_expand_failed",
      resolvedFrom: "https://t.co/abc123"
    });
  });

  it("rejects invalid non-status URLs", async () => {
    await expect(resolveReplyTarget({ targetUrl: "https://example.com/not-a-status" })).resolves.toEqual({
      ok: false,
      reason: "reply_target_invalid",
      resolvedFrom: "https://example.com/not-a-status"
    });
  });
});
