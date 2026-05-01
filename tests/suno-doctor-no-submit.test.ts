import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlaywrightSunoDriver, SUNO_CREATE_URL } from "../src/services/sunoPlaywrightDriver";

const { chromiumMock, launchPersistentContextMock, connectOverCDPMock, stealthPluginMock, stealthResult } = vi.hoisted(
  () => ({
    chromiumMock: {
      use: vi.fn(),
      launchPersistentContext: vi.fn(),
      connectOverCDP: vi.fn()
    },
    launchPersistentContextMock: vi.fn(),
    connectOverCDPMock: vi.fn(),
    stealthPluginMock: vi.fn(),
    stealthResult: { name: "stealth-plugin" }
  })
);

chromiumMock.launchPersistentContext = launchPersistentContextMock;
chromiumMock.connectOverCDP = connectOverCDPMock;

vi.mock("playwright", () => ({
  chromium: chromiumMock
}));

vi.mock("playwright-extra", () => ({
  chromium: chromiumMock
}));

vi.mock("puppeteer-extra-plugin-stealth", () => ({
  default: stealthPluginMock
}));

function isSubmitSelector(selector: string): boolean {
  return /(create|submit)/i.test(selector) || /button\[aria-label=["']Create song["']\]/i.test(selector);
}

function createSentinelPage() {
  const clickedSelectors: string[] = [];
  const makeLocator = (selector: string) => ({
    first: () => makeLocator(selector),
    count: vi.fn(async () => (selector === "a[href='/create']" ? 1 : 0)),
    isVisible: vi.fn(async () => false),
    isEditable: vi.fn(async () => true),
    waitFor: vi.fn(async () => undefined),
    fill: vi.fn(async () => undefined),
    getAttribute: vi.fn(async () => "false"),
    evaluateAll: vi.fn(async () => []),
    click: vi.fn(async () => {
      clickedSelectors.push(selector);
      if (isSubmitSelector(selector)) {
        throw new Error(`Suno doctor attempted submit/create click: ${selector}`);
      }
    })
  });

  return {
    clickedSelectors,
    page: {
      goto: vi.fn(async () => undefined),
      waitForLoadState: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      screenshot: vi.fn(async () => undefined),
      content: vi.fn(async () => "<html></html>"),
      url: vi.fn(() => SUNO_CREATE_URL),
      evaluate: vi.fn(async () => []),
      locator: vi.fn((selector: string) => makeLocator(selector))
    }
  };
}

function createSentinelContext(page: ReturnType<typeof createSentinelPage>["page"]) {
  return {
    pages: vi.fn(() => [page]),
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined)
  };
}

async function runAvailableSunoDoctor(page: ReturnType<typeof createSentinelPage>["page"]) {
  const modulePath = fileURLToPath(new URL("../src/services/sunoDoctor.ts", import.meta.url));
  if (existsSync(modulePath)) {
    const mod = await import(pathToFileURL(modulePath).href);
    const runner = mod.runSunoDoctor ?? mod.checkSunoDoctor;
    if (typeof runner === "function") {
      return runner({
        browser: {
          contexts: () => [createSentinelContext(page)],
          newContext: async () => createSentinelContext(page),
          disconnect: vi.fn()
        },
        page,
        fetch: vi.fn(),
        cdpEndpoint: "http://127.0.0.1:9222",
        profilePath: ".openclaw-browser-profiles/suno"
      });
    }
  }

  return new PlaywrightSunoDriver(".openclaw-browser-profiles/suno").probe();
}

describe("Suno doctor no-submit guard", () => {
  beforeEach(() => {
    launchPersistentContextMock.mockReset();
    connectOverCDPMock.mockReset();
    chromiumMock.use.mockReset();
    stealthPluginMock.mockReset();
    stealthPluginMock.mockReturnValue(stealthResult);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200
      }))
    );
  });

  it("checks readiness without clicking Create or submit", async () => {
    const { page, clickedSelectors } = createSentinelPage();
    const context = createSentinelContext(page);
    launchPersistentContextMock.mockResolvedValue(context);
    connectOverCDPMock.mockResolvedValue({
      contexts: vi.fn(() => [context]),
      newContext: vi.fn(async () => context),
      disconnect: vi.fn()
    });

    await expect(runAvailableSunoDoctor(page)).resolves.toBeTruthy();

    expect(clickedSelectors.filter(isSubmitSelector)).toEqual([]);
  });
});
