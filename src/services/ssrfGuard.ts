import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Outbound-fetch SSRF guard for news/article retrieval. The RSS feed list and (once A4a lands)
// UI-editable feeds can point the gateway at arbitrary URLs, so every fetch must refuse
// non-public destinations: only http/https, and no address inside a private/loopback/
// link-local/CGNAT/metadata range. Hostnames are resolved and every returned address is
// checked (resolve-then-check), and redirects are followed one hop at a time with the same
// check applied to each hop.

export const SSRF_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
export const SSRF_MAX_REDIRECTS = 5;

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

export type LookupImpl = (hostname: string) => Promise<Array<{ address: string }>>;

const defaultLookup: LookupImpl = (hostname) => lookup(hostname, { all: true });

function ipv4ToInt(ip: string): number | undefined {
  const parts = ip.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const n = Number(part);
    if (n > 255) return undefined;
    value = value * 256 + n;
  }
  return value >>> 0;
}

function ipv4InRange(value: number, base: string, bits: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt === undefined) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (baseInt & mask);
}

function ipv4Blocked(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === undefined) return true; // unparseable -> fail closed
  return (
    ipv4InRange(value, "0.0.0.0", 8) // "this" network
    || ipv4InRange(value, "10.0.0.0", 8) // private
    || ipv4InRange(value, "100.64.0.0", 10) // CGNAT
    || ipv4InRange(value, "127.0.0.0", 8) // loopback
    || ipv4InRange(value, "169.254.0.0", 16) // link-local incl 169.254.169.254 metadata
    || ipv4InRange(value, "172.16.0.0", 12) // private
    || ipv4InRange(value, "192.0.0.0", 24) // IETF protocol assignments
    || ipv4InRange(value, "192.0.2.0", 24) // TEST-NET-1
    || ipv4InRange(value, "192.168.0.0", 16) // private
    || ipv4InRange(value, "198.18.0.0", 15) // benchmarking
    || ipv4InRange(value, "198.51.100.0", 24) // TEST-NET-2
    || ipv4InRange(value, "203.0.113.0", 24) // TEST-NET-3
    || ipv4InRange(value, "224.0.0.0", 4) // multicast
    || ipv4InRange(value, "240.0.0.0", 4) // reserved / broadcast
  );
}

function ipv6Blocked(ip: string): boolean {
  const lower = ip.toLowerCase().split("%")[0]; // drop zone id
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return ipv4Blocked(mapped[1]); // IPv4-mapped -> check embedded v4
  if (/^f[cd][0-9a-f]*:/.test(lower) || lower === "fc00::" || lower === "fd00::") return true; // fc00::/7 ULA
  if (/^fe[89ab][0-9a-f]*:/.test(lower)) return true; // fe80::/10 link-local
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return ipv4Blocked(ip);
  if (kind === 6) return ipv6Blocked(ip);
  return true; // not a recognizable IP literal -> fail closed
}

// Validate scheme, then confirm the destination is a public address. IP literals are checked
// directly; hostnames are resolved and every returned address must be public.
export async function assertUrlPublic(rawUrl: string, lookupImpl: LookupImpl = defaultLookup): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError("ssrf_blocked: invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfBlockedError(`ssrf_blocked: scheme ${url.protocol} not allowed`);
  }
  const hostname = url.hostname.replace(/^\[/, "").replace(/\]$/, ""); // strip IPv6 brackets
  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new SsrfBlockedError(`ssrf_blocked: ${hostname} is not a public address`);
    }
    return url;
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookupImpl(hostname);
  } catch {
    throw new SsrfBlockedError(`ssrf_blocked: DNS resolution failed for ${hostname}`);
  }
  if (!addresses || addresses.length === 0) {
    throw new SsrfBlockedError(`ssrf_blocked: no addresses for ${hostname}`);
  }
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new SsrfBlockedError(`ssrf_blocked: ${hostname} resolves to non-public ${address}`);
    }
  }
  return url;
}

async function readTextCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) {
      throw new SsrfBlockedError(`ssrf_blocked: response exceeds ${maxBytes} byte cap`);
    }
    return text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new SsrfBlockedError(`ssrf_blocked: response exceeds ${maxBytes} byte cap`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface GuardedFetchOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  followRedirects?: boolean;
  maxRedirects?: number;
  maxBytes?: number;
  fetchImpl?: typeof fetch;
  lookupImpl?: LookupImpl;
}

// Fetch text with SSRF protection: each URL (initial and every redirect hop) is validated
// before the request, redirects are followed manually so intermediate hops cannot bypass the
// check, and the response body is capped.
export async function guardedFetchText(
  rawUrl: string,
  options: GuardedFetchOptions = {}
): Promise<{ status: number; text: string }> {
  const {
    timeoutMs = 15_000,
    headers = {},
    followRedirects = true,
    maxRedirects = SSRF_MAX_REDIRECTS,
    maxBytes = SSRF_MAX_RESPONSE_BYTES,
    fetchImpl = fetch,
    lookupImpl = defaultLookup
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let currentUrl = rawUrl;
    for (let redirectCount = 0; ; redirectCount += 1) {
      await assertUrlPublic(currentUrl, lookupImpl);
      const response = await fetchImpl(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers
      });
      if (followRedirects && response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location) {
          if (redirectCount >= maxRedirects) {
            throw new SsrfBlockedError("ssrf_blocked: too many redirects");
          }
          currentUrl = new URL(location, currentUrl).toString();
          continue;
        }
      }
      return { status: response.status, text: await readTextCapped(response, maxBytes) };
    }
  } finally {
    clearTimeout(timer);
  }
}
