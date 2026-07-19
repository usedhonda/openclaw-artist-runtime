import { describe, expect, it } from "vitest";
import {
  isSunoCdpEnabled,
  sunoBrowserChannel,
  sunoCdpEndpoint,
  sunoChromeExecutablePath,
  sunoChromeProfileDest
} from "../src/services/runtimeConfig";

function browserConfig(browser: Record<string, unknown>) {
  return { music: { suno: { browser } } };
}

describe("music.suno.browser accessor precedence", () => {
  it("prefers config profileDir over env, and falls back to env then the default", () => {
    expect(sunoChromeProfileDest(browserConfig({ profileDir: "/cfg/profile" }), { OPENCLAW_SUNO_CHROME_PROFILE_DEST: "/env/profile" })).toBe("/cfg/profile");
    expect(sunoChromeProfileDest(undefined, { OPENCLAW_SUNO_CHROME_PROFILE_DEST: "/env/profile" })).toBe("/env/profile");
    expect(sunoChromeProfileDest(undefined, {})).toBe(".openclaw-browser-profiles/suno");
  });

  it("prefers config executablePath over env, else undefined", () => {
    expect(sunoChromeExecutablePath(browserConfig({ executablePath: "/cfg/chrome" }), { OPENCLAW_SUNO_CHROME_EXECUTABLE: "/env/chrome" })).toBe("/cfg/chrome");
    expect(sunoChromeExecutablePath(undefined, { OPENCLAW_SUNO_CHROME_EXECUTABLE: "/env/chrome" })).toBe("/env/chrome");
    expect(sunoChromeExecutablePath(undefined, {})).toBeUndefined();
  });

  it("prefers config channel over env", () => {
    expect(sunoBrowserChannel(browserConfig({ channel: "chrome" }), {})).toBe("chrome");
    expect(sunoBrowserChannel(undefined, { OPENCLAW_SUNO_BROWSER_CHANNEL: "chrome" })).toBe("chrome");
    expect(sunoBrowserChannel(undefined, {})).toBeUndefined();
  });

  it("treats a config cdpEndpoint as CDP-enabled and returns it, else honors the legacy env", () => {
    const cfg = browserConfig({ cdpEndpoint: "http://127.0.0.1:7000" });
    expect(isSunoCdpEnabled(cfg, {})).toBe(true);
    expect(sunoCdpEndpoint(cfg, {})).toBe("http://127.0.0.1:7000");

    expect(isSunoCdpEnabled(undefined, { OPENCLAW_SUNO_USE_CDP: "on" })).toBe(true);
    expect(sunoCdpEndpoint(undefined, { OPENCLAW_SUNO_USE_CDP: "on", OPENCLAW_SUNO_CDP_ENDPOINT: "http://127.0.0.1:9333" })).toBe("http://127.0.0.1:9333");

    expect(isSunoCdpEnabled(undefined, {})).toBe(false);
    expect(sunoCdpEndpoint(undefined, {})).toBe("http://127.0.0.1:9222");
  });
});
