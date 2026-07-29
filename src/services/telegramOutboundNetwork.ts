import dns from "node:dns";
import net from "node:net";

// Opt-in IPv4 preference for the gateway's outbound connections.
//
// Symptom this addresses: `fetch("https://api.telegram.org/...")` intermittently throws
// UND_ERR_CONNECT_TIMEOUT while `curl` to the same host succeeds. DNS returns both an A
// (IPv4) and AAAA (IPv6) record; when the host's IPv6 route to Telegram is dead, undici
// (Node's global fetch) can stall on the IPv6 address for its full 10s connect timeout
// instead of falling back to IPv4 the way curl's Happy Eyeballs does. Measured on this
// runtime: default fetch failed intermittently at ~10.5s, IPv4-forced connects succeeded
// 20/20 at <1s.
//
// When enabled we prefer IPv4 for the whole process: order lookups IPv4-first and disable
// Node's autoSelectFamily racing so undici commits to the reachable IPv4 address. This is a
// process-global change, so it is off by default (distribution-safe) and opt-in via
// OPENCLAW_TELEGRAM_FORCE_IPV4 — operators whose network needs IPv6 leave it unset. It is
// applied once (idempotent) from the Telegram client, the single chokepoint for all Telegram
// traffic.

export interface OutboundIpv4PreferenceHooks {
  isEnabled: () => boolean;
  setResultOrder: (order: "ipv4first" | "ipv6first" | "verbatim") => void;
  setAutoSelectFamily: (value: boolean) => void;
  log: (message: string) => void;
}

let applied = false;

export function isTelegramForceIpv4Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.OPENCLAW_TELEGRAM_FORCE_IPV4 ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

// Returns true when the preference was applied by this call, false when it was disabled
// or already applied earlier in the process.
export function applyTelegramOutboundIpv4Preference(hooks: Partial<OutboundIpv4PreferenceHooks> = {}): boolean {
  const enabled = hooks.isEnabled ? hooks.isEnabled() : isTelegramForceIpv4Enabled();
  if (!enabled || applied) {
    return false;
  }
  const setResultOrder = hooks.setResultOrder ?? ((order) => dns.setDefaultResultOrder(order));
  const setAutoSelectFamily = hooks.setAutoSelectFamily ?? ((value) => net.setDefaultAutoSelectFamily(value));
  const log = hooks.log ?? ((message) => console.log(message));
  setResultOrder("ipv4first");
  setAutoSelectFamily(false);
  applied = true;
  log("[telegram-net] IPv4-preferred outbound enabled (OPENCLAW_TELEGRAM_FORCE_IPV4)");
  return true;
}

// Test-only: clears the once-guard so each test starts from a clean state.
export function resetTelegramOutboundIpv4PreferenceForTest(): void {
  applied = false;
}
