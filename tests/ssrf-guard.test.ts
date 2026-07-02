import { describe, expect, it, vi } from "vitest";
import {
  SsrfBlockedError,
  assertUrlPublic,
  guardedFetchText,
  isBlockedIp
} from "../src/services/ssrfGuard";

describe("ssrf guard", () => {
  describe("isBlockedIp", () => {
    it("blocks private, loopback, link-local, CGNAT, metadata, and reserved IPv4", () => {
      for (const ip of [
        "127.0.0.1",
        "10.0.0.5",
        "172.16.4.4",
        "172.31.255.255",
        "192.168.1.1",
        "169.254.169.254", // cloud metadata
        "169.254.1.1",
        "100.64.0.1", // CGNAT
        "0.0.0.0",
        "255.255.255.255"
      ]) {
        expect(isBlockedIp(ip)).toBe(true);
      }
    });

    it("allows public IPv4", () => {
      for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34"]) {
        expect(isBlockedIp(ip)).toBe(false);
      }
    });

    it("blocks loopback, ULA, link-local, and IPv4-mapped IPv6", () => {
      for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254"]) {
        expect(isBlockedIp(ip)).toBe(true);
      }
    });

    it("allows public IPv6", () => {
      expect(isBlockedIp("2001:4860:4860::8888")).toBe(false);
    });
  });

  describe("assertUrlPublic", () => {
    it("rejects non-http(s) schemes", async () => {
      await expect(assertUrlPublic("file:///etc/passwd")).rejects.toBeInstanceOf(SsrfBlockedError);
      await expect(assertUrlPublic("ftp://example.com/x")).rejects.toBeInstanceOf(SsrfBlockedError);
      await expect(assertUrlPublic("gopher://169.254.169.254/")).rejects.toBeInstanceOf(SsrfBlockedError);
    });

    it("rejects literal private / loopback / metadata IP hosts", async () => {
      await expect(assertUrlPublic("http://169.254.169.254/latest/meta-data/")).rejects.toBeInstanceOf(SsrfBlockedError);
      await expect(assertUrlPublic("http://127.0.0.1:8080/")).rejects.toBeInstanceOf(SsrfBlockedError);
      await expect(assertUrlPublic("http://10.0.0.1/")).rejects.toBeInstanceOf(SsrfBlockedError);
      await expect(assertUrlPublic("http://[::1]/")).rejects.toBeInstanceOf(SsrfBlockedError);
    });

    it("rejects a hostname that resolves to a private address", async () => {
      const lookupImpl = vi.fn().mockResolvedValue([{ address: "169.254.169.254" }]);
      await expect(assertUrlPublic("https://rebind.evil.example/", lookupImpl)).rejects.toBeInstanceOf(SsrfBlockedError);
      expect(lookupImpl).toHaveBeenCalledWith("rebind.evil.example");
    });

    it("allows a literal public IP host", async () => {
      const url = await assertUrlPublic("https://93.184.216.34/feed.xml");
      expect(url.hostname).toBe("93.184.216.34");
    });

    it("allows a hostname that resolves only to public addresses", async () => {
      const lookupImpl = vi.fn().mockResolvedValue([{ address: "93.184.216.34" }]);
      const url = await assertUrlPublic("https://news.example.com/rss", lookupImpl);
      expect(url.hostname).toBe("news.example.com");
    });
  });

  describe("guardedFetchText", () => {
    it("returns the body for a normal public https response", async () => {
      const fetchImpl = vi.fn(async () => new Response("<rss>ok</rss>", { status: 200 }));
      const { status, text } = await guardedFetchText("https://93.184.216.34/feed", {
        fetchImpl: fetchImpl as unknown as typeof fetch
      });
      expect(status).toBe(200);
      expect(text).toBe("<rss>ok</rss>");
    });

    it("blocks a redirect hop that points at a private address", async () => {
      const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } }));
      await expect(
        guardedFetchText("https://93.184.216.34/article", { fetchImpl: fetchImpl as unknown as typeof fetch })
      ).rejects.toBeInstanceOf(SsrfBlockedError);
    });

    it("enforces the response size cap", async () => {
      const fetchImpl = vi.fn(async () => new Response("x".repeat(2048), { status: 200 }));
      await expect(
        guardedFetchText("https://93.184.216.34/big", { maxBytes: 1024, fetchImpl: fetchImpl as unknown as typeof fetch })
      ).rejects.toBeInstanceOf(SsrfBlockedError);
    });

    it("stops after too many redirects", async () => {
      const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://93.184.216.34/next" } }));
      await expect(
        guardedFetchText("https://93.184.216.34/loop", { maxRedirects: 2, fetchImpl: fetchImpl as unknown as typeof fetch })
      ).rejects.toBeInstanceOf(SsrfBlockedError);
    });
  });
});
