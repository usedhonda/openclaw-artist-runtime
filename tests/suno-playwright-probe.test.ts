import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PlaywrightSunoDriver,
  PLAYWRIGHT_DRIVER_LOGIN_REQUIRED_DETAIL,
  SUNO_CREATE_URL
} from "../src/services/sunoPlaywrightDriver";

const { chromiumMock, launchPersistentContextMock, stealthPluginMock, stealthResult, binaryHealthMock, reinstallChromiumMock, launchFailureMock } = vi.hoisted(() => ({
  chromiumMock: {
    use: vi.fn(),
    launchPersistentContext: vi.fn()
  },
  launchPersistentContextMock: vi.fn(),
  stealthPluginMock: vi.fn(),
  stealthResult: { name: "stealth-plugin" },
  binaryHealthMock: vi.fn(),
  reinstallChromiumMock: vi.fn(),
  launchFailureMock: vi.fn()
}));

chromiumMock.launchPersistentContext = launchPersistentContextMock;

vi.mock("playwright-extra", () => ({
  chromium: chromiumMock
}));

vi.mock("puppeteer-extra-plugin-stealth", () => ({
  default: stealthPluginMock
}));

vi.mock("../src/services/sunoBinaryHealthCheck", () => ({
  checkSunoBrowserBinaryHealth: binaryHealthMock,
  reinstallPlaywrightChromium: reinstallChromiumMock,
  isSunoBrowserLaunchFailure: launchFailureMock
}));

function createPage({
  url = "https://suno.com/create",
  selectorCounts = {}
}: {
  url?: string;
  selectorCounts?: Record<string, number>;
} = {}) {
  return {
    goto: vi.fn(async () => undefined),
    waitForLoadState: vi.fn(async () => undefined),
    url: vi.fn(() => url),
    locator: vi.fn((selector: string) => ({
      count: vi.fn(async () => selectorCounts[selector] ?? 0)
    }))
  };
}

function createContext(page = createPage()) {
  return {
    pages: vi.fn(() => [page]),
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined)
  };
}

describe("PlaywrightSunoDriver probe", () => {
  beforeEach(() => {
    chromiumMock.use.mockReset();
    launchPersistentContextMock.mockReset();
    binaryHealthMock.mockReset();
    reinstallChromiumMock.mockReset();
    launchFailureMock.mockReset();
    stealthPluginMock.mockReset();
    stealthPluginMock.mockReturnValue(stealthResult);
    binaryHealthMock.mockResolvedValue({ ok: true, checkedAt: "2026-05-27T00:00:00.000Z" });
    reinstallChromiumMock.mockResolvedValue(undefined);
    launchFailureMock.mockReturnValue(false);
  });

  it("returns connected when the create surface is already available", async () => {
    const page = createPage({
      url: "https://suno.com/create",
      selectorCounts: {
        "a[href='/create']": 1
      }
    });
    const context = createContext(page);
    launchPersistentContextMock.mockResolvedValue(context);
    const driver = new PlaywrightSunoDriver(".openclaw-browser-profiles/suno");

    const result = await driver.probe();

    expect(result.state).toBe("connected");
    expect(stealthPluginMock).toHaveBeenCalledTimes(1);
    expect(chromiumMock.use).toHaveBeenCalledWith(stealthResult);
    expect(page.goto).toHaveBeenCalledWith(SUNO_CREATE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it("returns login_required when Suno redirects to sign-in", async () => {
    const page = createPage({
      url: "https://suno.com/sign-in",
      selectorCounts: {
        "input[type='password']": 1
      }
    });
    const context = createContext(page);
    launchPersistentContextMock.mockResolvedValue(context);
    const driver = new PlaywrightSunoDriver(".openclaw-browser-profiles/suno");

    const result = await driver.probe();

    expect(result).toEqual({
      state: "login_required",
      detail: PLAYWRIGHT_DRIVER_LOGIN_REQUIRED_DETAIL
    });
    expect(chromiumMock.use).toHaveBeenCalledWith(stealthResult);
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it("fails closed when Playwright launch raises an error", async () => {
    launchPersistentContextMock.mockRejectedValue(new Error("browser launch failed"));
    launchFailureMock.mockReturnValue(false);
    const driver = new PlaywrightSunoDriver(".openclaw-browser-profiles/suno");

    const result = await driver.probe();

    expect(result.state).toBe("disconnected");
    expect(result.detail).toContain("browser launch failed");
    expect(chromiumMock.use).toHaveBeenCalledWith(stealthResult);
  });

  it("reinstalls Chromium and retries once on launch crash", async () => {
    const page = createPage({
      url: "https://suno.com/create",
      selectorCounts: {
        "a[href='/create']": 1
      }
    });
    const context = createContext(page);
    launchPersistentContextMock
      .mockRejectedValueOnce(new Error("SIGABRT crashpad bootstrap_check_in"))
      .mockResolvedValueOnce(context);
    launchFailureMock.mockReturnValue(true);
    const driver = new PlaywrightSunoDriver(".openclaw-browser-profiles/suno");

    const result = await driver.probe();

    expect(result.state).toBe("connected");
    expect(reinstallChromiumMock).toHaveBeenCalledWith("playwright_chromium_launch_failed");
    expect(launchPersistentContextMock).toHaveBeenCalledTimes(2);
    expect(context.close).toHaveBeenCalledTimes(1);
  });
});
