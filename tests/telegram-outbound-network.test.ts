import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyTelegramOutboundIpv4Preference,
  isTelegramForceIpv4Enabled,
  resetTelegramOutboundIpv4PreferenceForTest
} from "../src/services/telegramOutboundNetwork";

afterEach(() => {
  resetTelegramOutboundIpv4PreferenceForTest();
  delete process.env.OPENCLAW_TELEGRAM_FORCE_IPV4;
});

describe("telegram outbound IPv4 preference", () => {
  it("is disabled by default and reads truthy env values", () => {
    expect(isTelegramForceIpv4Enabled({})).toBe(false);
    expect(isTelegramForceIpv4Enabled({ OPENCLAW_TELEGRAM_FORCE_IPV4: "0" })).toBe(false);
    for (const value of ["1", "true", "on", "yes", "  On "]) {
      expect(isTelegramForceIpv4Enabled({ OPENCLAW_TELEGRAM_FORCE_IPV4: value })).toBe(true);
    }
  });

  it("applies ipv4first + disables autoSelectFamily when enabled", () => {
    const setResultOrder = vi.fn();
    const setAutoSelectFamily = vi.fn();
    const applied = applyTelegramOutboundIpv4Preference({
      isEnabled: () => true,
      setResultOrder,
      setAutoSelectFamily,
      log: () => {}
    });
    expect(applied).toBe(true);
    expect(setResultOrder).toHaveBeenCalledWith("ipv4first");
    expect(setAutoSelectFamily).toHaveBeenCalledWith(false);
  });

  it("is a no-op when disabled", () => {
    const setResultOrder = vi.fn();
    const setAutoSelectFamily = vi.fn();
    const applied = applyTelegramOutboundIpv4Preference({
      isEnabled: () => false,
      setResultOrder,
      setAutoSelectFamily,
      log: () => {}
    });
    expect(applied).toBe(false);
    expect(setResultOrder).not.toHaveBeenCalled();
    expect(setAutoSelectFamily).not.toHaveBeenCalled();
  });

  it("applies at most once even across many calls (idempotent)", () => {
    const setAutoSelectFamily = vi.fn();
    const hooks = {
      isEnabled: () => true,
      setResultOrder: vi.fn(),
      setAutoSelectFamily,
      log: () => {}
    };
    expect(applyTelegramOutboundIpv4Preference(hooks)).toBe(true);
    expect(applyTelegramOutboundIpv4Preference(hooks)).toBe(false);
    expect(applyTelegramOutboundIpv4Preference(hooks)).toBe(false);
    expect(setAutoSelectFamily).toHaveBeenCalledTimes(1);
  });
});
