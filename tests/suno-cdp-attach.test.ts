import { mkdtempSync } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SunoBrowserWorker } from "../src/services/sunoBrowserWorker";
import { PlaywrightSunoDriver, SUNO_CREATE_URL, SUNO_LIBRARY_URL } from "../src/services/sunoPlaywrightDriver";

const {
  playwrightChromiumMock,
  playwrightExtraChromiumMock,
  connectOverCDPMock,
  launchPersistentContextMock,
  stealthPluginMock,
  stealthResult
} = vi.hoisted(() => ({
  playwrightChromiumMock: {
    connectOverCDP: vi.fn()
  },
  playwrightExtraChromiumMock: {
    use: vi.fn(),
    launchPersistentContext: vi.fn()
  },
  connectOverCDPMock: vi.fn(),
  launchPersistentContextMock: vi.fn(),
  stealthPluginMock: vi.fn(),
  stealthResult: { name: "stealth-plugin" }
}));

playwrightChromiumMock.connectOverCDP = connectOverCDPMock;
playwrightExtraChromiumMock.launchPersistentContext = launchPersistentContextMock;

vi.mock("playwright", () => ({
  chromium: playwrightChromiumMock
}));

vi.mock("playwright-extra", () => ({
  chromium: playwrightExtraChromiumMock
}));

vi.mock("puppeteer-extra-plugin-stealth", () => ({
  default: stealthPluginMock
}));

const envKeys = [
  "OPENCLAW_SUNO_USE_CDP",
  "OPENCLAW_SUNO_CDP_ENDPOINT",
  "OPENCLAW_SUNO_LIVE",
  "OPENCLAW_SUNO_CHROME_PROFILE_SOURCE",
  "OPENCLAW_SUNO_CHROME_PROFILE_DEST"
] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

function createPage() {
  const fills: Array<{ selector: string; value: string }> = [];
  const songUrlSnapshots: string[][] = [["https://suno.com/song/existing-1"]];
  return {
    fills,
    goto: vi.fn(async () => undefined),
    waitForLoadState: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => undefined),
    content: vi.fn(async () => "<html></html>"),
    url: vi.fn(() => SUNO_CREATE_URL),
    evaluate: vi.fn(async () => songUrlSnapshots.shift() ?? []),
    locator: vi.fn((selector: string) => ({
      first: () => ({
        isVisible: vi.fn(async () => selector === "textarea[data-testid=\"lyrics-textarea\"]"),
        fill: vi.fn(async (value: string) => fills.push({ selector, value }))
      }),
      fill: vi.fn(async (value: string) => fills.push({ selector, value })),
      click: vi.fn(async () => undefined),
      count: vi.fn(async () => selector === "textarea[data-testid=\"lyrics-textarea\"]" ? 1 : 0),
      getAttribute: vi.fn(async () => "false"),
      evaluateAll: vi.fn(async () => [])
    }))
  };
}

function createContext(page = createPage()) {
  return {
    page,
    context: {
      pages: vi.fn(() => [page]),
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined)
    }
  };
}

describe("Suno CDP attach", () => {
  beforeEach(() => {
    connectOverCDPMock.mockReset();
    launchPersistentContextMock.mockReset();
    playwrightExtraChromiumMock.use.mockReset();
    stealthPluginMock.mockReset();
    stealthPluginMock.mockReturnValue(stealthResult);
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("uses connectOverCDP when Suno CDP attach is enabled", async () => {
    process.env.OPENCLAW_SUNO_USE_CDP = "on";
    process.env.OPENCLAW_SUNO_CDP_ENDPOINT = "http://127.0.0.1:9333";
    const { page, context } = createContext();
    const browser = {
      contexts: vi.fn(() => [context]),
      newContext: vi.fn(async () => context)
    };
    connectOverCDPMock.mockResolvedValue(browser);
    const driver = new PlaywrightSunoDriver(".openclaw-browser-profiles/suno", "skip");

    const result = await driver.create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "cdp-run",
      payload: { lyrics: "line one" }
    });

    expect(result.reason).toBe("submit_skipped");
    expect(connectOverCDPMock).toHaveBeenCalledWith("http://127.0.0.1:9333");
    expect(launchPersistentContextMock).not.toHaveBeenCalled();
    expect(playwrightExtraChromiumMock.use).not.toHaveBeenCalled();
    expect(context.close).not.toHaveBeenCalled();
    expect(page.goto).toHaveBeenNthCalledWith(1, SUNO_LIBRARY_URL, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    expect(page.goto).toHaveBeenNthCalledWith(2, SUNO_CREATE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
  });

  it("keeps the persistent profile path when CDP attach is disabled", async () => {
    process.env.OPENCLAW_SUNO_USE_CDP = "off";
    const { context } = createContext();
    launchPersistentContextMock.mockResolvedValue(context);
    const driver = new PlaywrightSunoDriver(".openclaw-browser-profiles/suno", "skip");

    await driver.create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "profile-run",
      payload: { lyrics: "line one" }
    });

    expect(connectOverCDPMock).not.toHaveBeenCalled();
    expect(launchPersistentContextMock).toHaveBeenCalledWith(".openclaw-browser-profiles/suno", {
      headless: false,
      channel: "chrome",
      args: ["--disable-blink-features=AutomationControlled", "--password-store=basic"],
      ignoreDefaultArgs: ["--enable-automation"]
    });
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it("skips operator profile copying when the worker uses CDP attach", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-cdp-worker-"));
    const source = join(root, "Chrome", "Default");
    const dest = join(root, "dedicated-suno-profile");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "Cookies"), "operator-cookie-state", "utf8");
    process.env.OPENCLAW_SUNO_LIVE = "on";
    process.env.OPENCLAW_SUNO_USE_CDP = "on";
    process.env.OPENCLAW_SUNO_CHROME_PROFILE_SOURCE = source;
    process.env.OPENCLAW_SUNO_CHROME_PROFILE_DEST = dest;
    const { context } = createContext();
    const browser = {
      contexts: vi.fn(() => [context]),
      newContext: vi.fn(async () => context)
    };
    connectOverCDPMock.mockResolvedValue(browser);

    await new SunoBrowserWorker(root).start();

    expect(connectOverCDPMock).toHaveBeenCalledWith("http://127.0.0.1:9222");
    await expect(access(join(dest, "Default", "Cookies"))).rejects.toThrow();
  });
});
