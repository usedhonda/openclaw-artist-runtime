import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isSunoCdpEnabled,
  sunoBrowserChannel,
  sunoCdpEndpoint,
  sunoChromeExecutablePath,
  sunoChromeProfileDest
} from "../src/services/runtimeConfig";

const { playwrightExtraChromiumMock, launchPersistentContextMock, binaryHealthMock } = vi.hoisted(() => ({
  playwrightExtraChromiumMock: { launchPersistentContext: vi.fn() },
  launchPersistentContextMock: vi.fn(),
  binaryHealthMock: vi.fn()
}));

playwrightExtraChromiumMock.launchPersistentContext = launchPersistentContextMock;

vi.mock("playwright-extra", () => ({ chromium: playwrightExtraChromiumMock }));
vi.mock("../src/services/sunoBinaryHealthCheck", () => ({
  checkSunoBrowserBinaryHealth: binaryHealthMock,
  reinstallPlaywrightChromium: vi.fn(),
  isSunoBrowserLaunchFailure: vi.fn(() => false)
}));

import { launchSunoPersistentContext, shouldUseRebrowser } from "../src/services/sunoBrowserLaunch";

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

describe("Suno browser launcher compatibility", () => {
  it("uses rebrowser only with the bundled Chromium lane", () => {
    expect(shouldUseRebrowser(undefined)).toBe(true);
    expect(shouldUseRebrowser(browserConfig({ channel: "chrome" }))).toBe(false);
    expect(shouldUseRebrowser(browserConfig({ executablePath: "/custom/chrome" }))).toBe(false);
  });
});

describe("launchSunoPersistentContext platform args", () => {
  let profile: string;

  beforeEach(() => {
    profile = mkdtempSync(join(tmpdir(), "artist-runtime-suno-launch-"));
    launchPersistentContextMock.mockReset().mockResolvedValue({ close: vi.fn() });
    binaryHealthMock.mockReset().mockResolvedValue({ ok: true, checkedAt: "2026-07-18T00:00:00.000Z" });
  });

  afterEach(async () => {
    await rm(profile, { recursive: true, force: true });
  });

  it("appends --disable-dev-shm-usage exactly once, after the existing args, on linux", async () => {
    await launchSunoPersistentContext(profile, { extraArgs: ["--remote-debugging-port=54321"], platform: "linux" });

    const [, launchOptions] = launchPersistentContextMock.mock.calls[0];
    const args = launchOptions.args as string[];
    expect(args.filter((arg) => arg === "--disable-dev-shm-usage")).toHaveLength(1);
    expect(args[args.length - 1]).toBe("--disable-dev-shm-usage");
    expect(args.indexOf("--remote-debugging-port=54321")).toBeLessThan(args.indexOf("--disable-dev-shm-usage"));
  });

  it("omits --disable-dev-shm-usage on darwin, leaving args byte-identical to the pre-change shape", async () => {
    await launchSunoPersistentContext(profile, { extraArgs: ["--remote-debugging-port=54321"], platform: "darwin" });

    const [, launchOptions] = launchPersistentContextMock.mock.calls[0];
    const args = launchOptions.args as string[];
    expect(args).not.toContain("--disable-dev-shm-usage");
    expect(args[args.length - 1]).toBe("--remote-debugging-port=54321");
  });
});
