import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  SsrfBlockedError,
  assertUrlPublic,
  guardedFetchText,
  isBlockedIp
} from "../src/services/ssrfGuard";

// These tests never make a network request. Exercise equivalent spellings at
// the IP, URL, DNS-answer and redirect boundaries, not just the IP helper.
const privateV4 = [
  "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1",
  "169.254.169.254", "172.16.0.1", "192.0.0.1", "192.0.2.1",
  "192.168.1.1", "198.18.0.1", "198.51.100.1", "203.0.113.1",
  "224.0.0.1", "255.255.255.255"
];

function mappedSpellings(ip: string): string[] {
  const [a, b, c, d] = ip.split(".").map(Number);
  const high = ((a << 8) | b).toString(16);
  const low = ((c << 8) | d).toString(16);
  return [
    `::ffff:${ip}`,
    `::ffff:${high}:${low}`,
    `0:0:0:0:0:ffff:${high}:${low}`,
    `0000:0000:0000:0000:0000:FFFF:${high.padStart(4, "0")}:${low.padStart(4, "0")}`
  ];
}

const privateMapped = privateV4.flatMap(mappedSpellings);
const expandedLocal = [
  "0:0:0:0:0:0:0:0", "0000:0000:0000:0000:0000:0000:0000:0000",
  "0:0:0:0:0:0:0:1", "0000:0000:0000:0000:0000:0000:0000:0001",
  "::0:1", "0::1"
];

describe("IPv6 destination normalization", () => {
  it("applies every existing IPv4 exclusion to all mapped spellings", () => {
    for (const ip of privateMapped) assert.equal(isBlockedIp(ip), true, ip);
  });

  it("blocks expanded and compressed loopback/unspecified addresses", () => {
    for (const ip of expandedLocal) assert.equal(isBlockedIp(ip), true, ip);
  });

  it("keeps legitimate public IPv4-mapped addresses allowed", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34"].flatMap(mappedSpellings)) {
      assert.equal(isBlockedIp(ip), false, ip);
    }
  });

  it("preserves public IPv6, ULA and link-local classification", () => {
    for (const ip of ["2001:4860:4860::8888", "2001:4860:4860:0:0:0:0:8888"]) {
      assert.equal(isBlockedIp(ip), false, ip);
    }
    for (const ip of ["FC00:0:0:0:0:0:0:1", "fd12:3456::1", "FE80:0:0:0:0:0:0:1"]) {
      assert.equal(isBlockedIp(ip), true, ip);
    }
  });

  it("fails closed on scoped and malformed IPv6 inputs", () => {
    for (const ip of ["fe80::1%eth0", "2001:4860:4860::8888%eth0", "::ffff:gggg:1", "::ffff:999.0.0.1"]) {
      assert.equal(isBlockedIp(ip), true, ip);
    }
  });

  it("blocks mapped URL literals after WHATWG normalization without DNS", async () => {
    let lookups = 0;
    const lookupImpl = async () => { lookups += 1; return [{ address: "8.8.8.8" }]; };
    for (const ip of privateMapped) {
      await assert.rejects(assertUrlPublic(`http://[${ip}]/`, lookupImpl), SsrfBlockedError, ip);
    }
    assert.equal(lookups, 0);
  });

  it("allows public mapped URL literals without DNS", async () => {
    const lookupImpl = async () => { throw new Error("literal unexpectedly resolved"); };
    for (const ip of mappedSpellings("8.8.8.8")) {
      const result = await assertUrlPublic(`https://[${ip}]/`, lookupImpl);
      assert.equal(result.hostname, "[::ffff:808:808]");
    }
  });

  it("rejects non-public DNS answers even alongside a public answer", async () => {
    for (const ip of [...privateMapped, ...expandedLocal]) {
      await assert.rejects(
        assertUrlPublic("https://feed.example/", async () => [{ address: "8.8.8.8" }, { address: ip }]),
        SsrfBlockedError,
        ip
      );
    }
  });

  it("does not invoke fetch for mapped non-public initial URLs", async () => {
    let requests = 0;
    const fetchImpl: typeof fetch = async () => { requests += 1; return new Response("unexpected"); };
    for (const ip of privateMapped) {
      await assert.rejects(guardedFetchText(`http://[${ip}]/`, { fetchImpl }), SsrfBlockedError, ip);
    }
    assert.equal(requests, 0);
  });

  it("does not follow a redirect to mapped non-public destinations", async () => {
    for (const ip of mappedSpellings("127.0.0.1")) {
      let requests = 0;
      const fetchImpl: typeof fetch = async () => {
        requests += 1;
        if (requests > 1) return new Response("unexpected");
        return new Response(null, { status: 302, headers: { location: `http://[${ip}]/` } });
      };
      await assert.rejects(guardedFetchText("https://8.8.8.8/feed", { fetchImpl }), SsrfBlockedError, ip);
      assert.equal(requests, 1);
    }
  });

  it("still fetches public mapped destinations", async () => {
    let requests = 0;
    const fetchImpl: typeof fetch = async () => { requests += 1; return new Response("ok", { status: 200 }); };
    const result = await guardedFetchText("https://[::ffff:8.8.8.8]/", { fetchImpl });
    assert.deepEqual(result, { status: 200, text: "ok" });
    assert.equal(requests, 1);
  });
});
