import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLAYWRIGHT_CREATE_CARD_REASON,
  PLAYWRIGHT_CREATE_DOM_MISSING_REASON,
  PLAYWRIGHT_CREATE_LOGIN_EXPIRED_REASON,
  PLAYWRIGHT_CREATE_NETWORK_REASON,
  PLAYWRIGHT_CREATE_RATE_LIMITED_REASON,
  PLAYWRIGHT_CREATE_SKIPPED_REASON,
  PLAYWRIGHT_CREATE_TIMEOUT_REASON,
  PLAYWRIGHT_LIBRARY_DIFF_REASON,
  PLAYWRIGHT_LIVE_TIMEOUT_REASON,
  PlaywrightSunoDriver,
  SUNO_LIBRARY_URL,
  SUNO_CREATE_URL
} from "../src/services/sunoPlaywrightDriver";

const {
  chromiumMock,
  launchPersistentContextMock,
  stealthPluginMock,
  stealthResult
} = vi.hoisted(() => ({
  chromiumMock: {
    use: vi.fn(),
    launchPersistentContext: vi.fn()
  },
  launchPersistentContextMock: vi.fn(),
  stealthPluginMock: vi.fn(),
  stealthResult: { name: "stealth-plugin" }
}));

chromiumMock.launchPersistentContext = launchPersistentContextMock;

vi.mock("playwright-extra", () => ({
  chromium: chromiumMock
}));

vi.mock("puppeteer-extra-plugin-stealth", () => ({
  default: stealthPluginMock
}));

function createPage() {
  const clicks: string[] = [];
  const fills: Array<{ selector: string; value: string }> = [];
  const selectors: string[] = [];
  const attributes: Record<string, string | null> = {
    "button[aria-label=\"Check this to generate an instrumental only song\"]": "false"
  };
  const counts: Record<string, number> = {
    "textarea[data-testid=\"lyrics-textarea\"]": 1
  };
  const visible: Record<string, boolean> = {
    "textarea[data-testid=\"lyrics-textarea\"]": true,
    "button[aria-label=\"Add your own lyrics\"]": true
  };
  const clickErrors: Record<string, Error> = {};
  const createCardSnapshots: string[][] = [];
  const songUrlSnapshots: string[][] = [
    ["https://suno.com/song/existing-1"]
  ];
  return {
    clicks,
    fills,
    selectors,
    counts,
    visible,
    clickErrors,
    createCardSnapshots,
    songUrlSnapshots,
    goto: vi.fn(async () => undefined),
    waitForLoadState: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => undefined),
    content: vi.fn(async () => "<html><body>suno create</body></html>"),
    url: vi.fn(() => SUNO_CREATE_URL),
    evaluate: vi.fn(async () => songUrlSnapshots.shift() ?? []),
    locator: vi.fn((selector: string) => {
      selectors.push(selector);
      return {
      first: () => ({
        isVisible: vi.fn(async () => visible[selector] ?? false),
        waitFor: vi.fn(async () => {
          if (visible[selector]) {
            return;
          }
          throw new Error(`not visible: ${selector}`);
        }),
        click: vi.fn(async () => {
          if (clickErrors[selector]) {
            throw clickErrors[selector];
          }
          clicks.push(selector);
        }),
        fill: vi.fn(async (value: string) => {
          fills.push({ selector, value });
        })
      }),
      fill: vi.fn(async (value: string) => {
        fills.push({ selector, value });
      }),
      click: vi.fn(async () => {
        if (clickErrors[selector]) {
          throw clickErrors[selector];
        }
        clicks.push(selector);
      }),
      count: vi.fn(async () => counts[selector] ?? 0),
      getAttribute: vi.fn(async (name: string) => (name === "aria-pressed" ? attributes[selector] ?? null : null)),
      evaluateAll: vi.fn(async () => createCardSnapshots.shift() ?? [])
    };
    })
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

describe("PlaywrightSunoDriver create", () => {
  beforeEach(() => {
    chromiumMock.use.mockReset();
    launchPersistentContextMock.mockReset();
    stealthPluginMock.mockReset();
    stealthPluginMock.mockReturnValue(stealthResult);
  });

  it("fills lyrics, style, and exclude fields without clicking Create in skip mode", async () => {
    const { page, context } = createContext();
    launchPersistentContextMock.mockResolvedValue(context);
    const driver = new PlaywrightSunoDriver(".openclaw-browser-profiles/suno", "skip");

    const result = await driver.create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "run-001",
      payload: {
        lyrics: "line one\nline two",
        styleAndFeel: "cold synth texture",
        excludeStyles: "generic edm drop",
        instrumental: false
      }
    });

    expect(result.reason).toBe(PLAYWRIGHT_CREATE_SKIPPED_REASON);
    expect(page.goto).toHaveBeenNthCalledWith(1, SUNO_LIBRARY_URL, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    expect(page.goto).toHaveBeenNthCalledWith(2, SUNO_CREATE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    expect(page.fills).toContainEqual({
      selector: "textarea[data-testid=\"lyrics-textarea\"]",
      value: "line one\nline two"
    });
    expect(page.fills).toContainEqual({
      selector: "[data-testid=\"create-form-styles-wrapper\"] textarea, textarea[placeholder=\"Describe the sound you want\"], textarea[placeholder*=\"クラシック音楽\"], textarea[placeholder*=\"バイキングメタル\"], textarea[placeholder*=\"sound you want\"]",
      value: "cold synth texture"
    });
    expect(page.fills).toContainEqual({
      selector: "input[placeholder=\"Exclude styles\"]",
      value: "generic edm drop"
    });
    expect(page.clicks).not.toContain("button[aria-label=\"Create song\"]");
    expect(page.waitForTimeout).not.toHaveBeenCalled();
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it("clicks the instrumental toggle when requested and still skips submit", async () => {
    const { page, context } = createContext();
    launchPersistentContextMock.mockResolvedValue(context);
    const driver = new PlaywrightSunoDriver(".openclaw-browser-profiles/suno", "skip");

    const result = await driver.create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "run-002",
      payload: {
        styleAndFeel: "drone folk",
        instrumental: true
      }
    });

    expect(result.reason).toBe(PLAYWRIGHT_CREATE_SKIPPED_REASON);
    expect(page.clicks).toContain("button[aria-label=\"Check this to generate an instrumental only song\"]");
    expect(page.clicks).not.toContain("button[aria-label=\"Create song\"]");
  });

  it("waits for the lyrics textarea before clicking the lyrics mode toggle", async () => {
    const { page, context } = createContext();
    page.visible["textarea[data-testid=\"lyrics-textarea\"]"] = true;
    launchPersistentContextMock.mockResolvedValue(context);
    const driver = new PlaywrightSunoDriver(".openclaw-browser-profiles/suno", "skip");

    await driver.create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "run-visible-lyrics",
      payload: { lyrics: "line one" }
    });

    expect(page.clicks).not.toContain("button[aria-label=\"Add your own lyrics\"]");
    expect(page.fills).toContainEqual({
      selector: "textarea[data-testid=\"lyrics-textarea\"]",
      value: "line one"
    });
  });

  it("clicks the lyrics mode toggle when the textarea wait times out and the button is visible", async () => {
    const { page, context } = createContext();
    page.visible["textarea[data-testid=\"lyrics-textarea\"]"] = false;
    page.visible["button[aria-label=\"Add your own lyrics\"]"] = true;
    launchPersistentContextMock.mockResolvedValue(context);
    const driver = new PlaywrightSunoDriver(".openclaw-browser-profiles/suno", "skip");

    await driver.create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "run-hidden-lyrics",
      payload: { lyrics: "line one" }
    });

    expect(page.clicks).toContain("button[aria-label=\"Add your own lyrics\"]");
  });

  it("does nothing when the textarea wait times out and the lyrics mode toggle is hidden", async () => {
    const { page, context } = createContext();
    page.visible["textarea[data-testid=\"lyrics-textarea\"]"] = false;
    page.visible["button[aria-label=\"Add your own lyrics\"]"] = false;
    launchPersistentContextMock.mockResolvedValue(context);
    const driver = new PlaywrightSunoDriver(".openclaw-browser-profiles/suno", "skip");

    await driver.create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "run-hidden-both-lyrics",
      payload: { lyrics: "line one" }
    });

    expect(page.clicks).not.toContain("button[aria-label=\"Add your own lyrics\"]");
    expect(page.fills).toContainEqual({
      selector: "textarea[data-testid=\"lyrics-textarea\"]",
      value: "line one"
    });
  });

  it("clicks Create and returns accepted with new song URLs in live mode", async () => {
    const { page, context } = createContext();
    page.songUrlSnapshots.push(
      ["https://suno.com/song/existing-1"],
      ["https://suno.com/song/existing-1", "https://suno.com/song/new-1", "https://suno.com/song/new-2"]
    );
    launchPersistentContextMock.mockResolvedValue(context);
    const driver = new PlaywrightSunoDriver(
      ".openclaw-browser-profiles/suno",
      "live",
      mkdtempSync(join(tmpdir(), "artist-runtime-suno-create-timeout-")),
      { intervalMs: 1, timeoutMs: 3, createCardTimeoutMs: 1 }
    );

    const result = await driver.create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "run-003",
      payload: {
        lyrics: "line one"
      }
    });

    expect(result).toEqual({
      accepted: true,
      runId: "run-003",
      reason: PLAYWRIGHT_LIBRARY_DIFF_REASON,
      urls: ["https://suno.com/song/new-1", "https://suno.com/song/new-2"],
      dryRun: false
    });
    expect(page.clicks).toContain("button[aria-label=\"Create song\"]");
  });

  it("returns accepted from create-card polling before library fallback", async () => {
    const { page, context } = createContext();
    page.createCardSnapshots.push([], ["https://suno.com/song/existing-1", "https://suno.com/song/new-card-1"]);
    launchPersistentContextMock.mockResolvedValue(context);
    const driver = new PlaywrightSunoDriver(
      ".openclaw-browser-profiles/suno",
      "live",
      mkdtempSync(join(tmpdir(), "artist-runtime-suno-create-timeout-")),
      { intervalMs: 1, timeoutMs: 4, createCardTimeoutMs: 2 }
    );

    const result = await driver.create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "run-003b",
      payload: {
        lyrics: "line one"
      }
    });

    expect(result).toEqual({
      accepted: true,
      runId: "run-003b",
      reason: PLAYWRIGHT_CREATE_CARD_REASON,
      urls: ["https://suno.com/song/new-card-1"],
      dryRun: false
    });
    expect(page.clicks).toContain("button[aria-label=\"Create song\"]");
    expect(page.goto.mock.calls.filter(([url]) => url === SUNO_LIBRARY_URL)).toHaveLength(1);
  });

  it("ignores create-card URLs already present in the baseline and falls back to library diff", async () => {
    const { page, context } = createContext();
    page.createCardSnapshots.push(
      ["https://suno.com/song/existing-1"],
      ["https://suno.com/song/existing-1"]
    );
    page.songUrlSnapshots.push(
      ["https://suno.com/song/existing-1"],
      ["https://suno.com/song/existing-1", "https://suno.com/song/new-lib-after-card-baseline"]
    );
    launchPersistentContextMock.mockResolvedValue(context);
    const driver = new PlaywrightSunoDriver(
      ".openclaw-browser-profiles/suno",
      "live",
      ".",
      { intervalMs: 1, timeoutMs: 4, createCardTimeoutMs: 2 }
    );

    const result = await driver.create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "run-003bb",
      payload: {
        lyrics: "line one"
      }
    });

    expect(result).toEqual({
      accepted: true,
      runId: "run-003bb",
      reason: PLAYWRIGHT_LIBRARY_DIFF_REASON,
      urls: ["https://suno.com/song/new-lib-after-card-baseline"],
      dryRun: false
    });
  });

  it("keeps create-card polling scoped away from generic library song links", async () => {
    const { page, context } = createContext();
    page.createCardSnapshots.push([], []);
    page.songUrlSnapshots.push(
      ["https://suno.com/song/existing-1"],
      ["https://suno.com/song/existing-1", "https://suno.com/song/new-lib-scoped-selector"]
    );
    launchPersistentContextMock.mockResolvedValue(context);
    const driver = new PlaywrightSunoDriver(
      ".openclaw-browser-profiles/suno",
      "live",
      ".",
      { intervalMs: 1, timeoutMs: 4, createCardTimeoutMs: 2 }
    );

    const result = await driver.create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "run-003bd",
      payload: {
        lyrics: "line one"
      }
    });

    const createCardSelector = page.selectors.find((selector) => selector.includes("generation-card"));
    expect(createCardSelector).toBeDefined();
    expect(createCardSelector).not.toContain("[role='listitem']");
    expect(createCardSelector).not.toContain("li a[href*='/song/']");
    expect(createCardSelector?.split(", ").some((selector) => selector === "a[href*='/song/']")).toBe(false);
    expect(result.reason).toBe(PLAYWRIGHT_LIBRARY_DIFF_REASON);
    expect(result.urls).toEqual(["https://suno.com/song/new-lib-scoped-selector"]);
  });

  it("falls back to library diff when create-card polling finds nothing", async () => {
    const { page, context } = createContext();
    page.createCardSnapshots.push([], [], []);
    page.songUrlSnapshots.push(
      ["https://suno.com/song/existing-1"],
      ["https://suno.com/song/existing-1", "https://suno.com/song/new-lib-1"]
    );
    launchPersistentContextMock.mockResolvedValue(context);
    const driver = new PlaywrightSunoDriver(
      ".openclaw-browser-profiles/suno",
      "live",
      ".",
      { intervalMs: 1, timeoutMs: 4, createCardTimeoutMs: 2 }
    );

    const result = await driver.create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "run-003c",
      payload: {
        lyrics: "line one"
      }
    });

    expect(result).toEqual({
      accepted: true,
      runId: "run-003c",
      reason: PLAYWRIGHT_LIBRARY_DIFF_REASON,
      urls: ["https://suno.com/song/new-lib-1"],
      dryRun: false
    });
    expect(page.waitForTimeout).toHaveBeenCalledWith(1);
    expect(page.goto.mock.calls.filter(([url]) => url === SUNO_LIBRARY_URL).length).toBeGreaterThan(1);
  });

  it("times out in live mode when no new song URLs appear", async () => {
    const { page, context } = createContext();
    page.createCardSnapshots.push([], [], []);
    page.songUrlSnapshots.push(
      ["https://suno.com/song/existing-1"],
      ["https://suno.com/song/existing-1"],
      ["https://suno.com/song/existing-1"]
    );
    launchPersistentContextMock.mockResolvedValue(context);
    const driver = new PlaywrightSunoDriver(
      ".openclaw-browser-profiles/suno",
      "live",
      ".",
      { intervalMs: 1, timeoutMs: 4, createCardTimeoutMs: 2 }
    );

    const result = await driver.create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "run-004",
      payload: {
        lyrics: "line one"
      }
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe(PLAYWRIGHT_LIVE_TIMEOUT_REASON);
    expect(page.clicks).toContain("button[aria-label=\"Create song\"]");
    expect(page.waitForTimeout).toHaveBeenCalledWith(1);
  });

  it("times out when both create-card polling and library fallback find no new songs", async () => {
    const { page, context } = createContext();
    page.createCardSnapshots.push([], [], []);
    page.songUrlSnapshots.push(
      ["https://suno.com/song/existing-1"],
      ["https://suno.com/song/existing-1"],
      ["https://suno.com/song/existing-1"]
    );
    launchPersistentContextMock.mockResolvedValue(context);
    const driver = new PlaywrightSunoDriver(
      ".openclaw-browser-profiles/suno",
      "live",
      ".",
      { intervalMs: 1, timeoutMs: 4, createCardTimeoutMs: 2 }
    );

    const result = await driver.create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "run-004b",
      payload: {
        lyrics: "line one"
      }
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe(PLAYWRIGHT_LIVE_TIMEOUT_REASON);
    expect(page.clicks).toContain("button[aria-label=\"Create song\"]");
    expect(page.waitForTimeout).toHaveBeenCalledWith(1);
    expect(page.goto.mock.calls.filter(([url]) => url === SUNO_LIBRARY_URL).length).toBeGreaterThan(1);
  });

  it("classifies create timeouts as graceful timeout failures", async () => {
    launchPersistentContextMock.mockRejectedValue(new Error("Timeout 20000ms exceeded"));
    const driver = new PlaywrightSunoDriver(".openclaw-browser-profiles/suno", "skip");

    const result = await driver.create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "run-005",
      payload: {}
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain(PLAYWRIGHT_CREATE_TIMEOUT_REASON);
  });

  it("classifies network failures before returning create errors", async () => {
    launchPersistentContextMock.mockRejectedValue(new Error("net::ERR_CONNECTION_RESET"));
    const driver = new PlaywrightSunoDriver(".openclaw-browser-profiles/suno", "skip");

    const result = await driver.create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "run-006",
      payload: {}
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain(PLAYWRIGHT_CREATE_NETWORK_REASON);
  });

  it("classifies DOM selector misses before returning create errors", async () => {
    launchPersistentContextMock.mockRejectedValue(new Error("locator selector not found"));
    const driver = new PlaywrightSunoDriver(".openclaw-browser-profiles/suno", "skip");

    const result = await driver.create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "run-007",
      payload: {}
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain(PLAYWRIGHT_CREATE_DOM_MISSING_REASON);
  });

  it("captures a failure snapshot when a create-page DOM action fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-create-dom-snapshot-"));
    const { page, context } = createContext();
    page.visible["textarea[data-testid=\"lyrics-textarea\"]"] = false;
    page.clickErrors["button[aria-label=\"Add your own lyrics\"]"] = new Error("locator selector not found");
    launchPersistentContextMock.mockResolvedValue(context);
    const driver = new PlaywrightSunoDriver(".openclaw-browser-profiles/suno", "skip", root);

    const result = await driver.create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "run-dom-snapshot",
      songId: "song-004",
      payload: { lyrics: "line one" }
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain(PLAYWRIGHT_CREATE_DOM_MISSING_REASON);
    expect(page.screenshot).toHaveBeenCalledWith(expect.objectContaining({
      path: expect.stringContaining(PLAYWRIGHT_CREATE_DOM_MISSING_REASON)
    }));
    expect(page.content).toHaveBeenCalled();
  });

  it("does not mask the original create failure when snapshot capture fails", async () => {
    const { page, context } = createContext();
    page.visible["textarea[data-testid=\"lyrics-textarea\"]"] = false;
    page.clickErrors["button[aria-label=\"Add your own lyrics\"]"] = new Error("locator selector not found");
    page.screenshot.mockRejectedValue(new Error("disk full"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    launchPersistentContextMock.mockResolvedValue(context);
    const driver = new PlaywrightSunoDriver(".openclaw-browser-profiles/suno", "skip", mkdtempSync(join(tmpdir(), "artist-runtime-suno-create-snapshot-fail-")));

    const result = await driver.create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "run-dom-snapshot-fail",
      payload: { lyrics: "line one" }
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain(PLAYWRIGHT_CREATE_DOM_MISSING_REASON);
    expect(result.reason).toContain("locator selector not found");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Suno failure snapshot skipped"));
    warn.mockRestore();
  });

  it("classifies expired login failures before returning create errors", async () => {
    launchPersistentContextMock.mockRejectedValue(new Error("Suno login required"));
    const driver = new PlaywrightSunoDriver(".openclaw-browser-profiles/suno", "skip");

    const result = await driver.create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "run-008",
      payload: {}
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain(PLAYWRIGHT_CREATE_LOGIN_EXPIRED_REASON);
  });

  it("classifies rate limits before returning create errors", async () => {
    launchPersistentContextMock.mockRejectedValue(new Error("HTTP 429 too many requests"));
    const driver = new PlaywrightSunoDriver(".openclaw-browser-profiles/suno", "skip");

    const result = await driver.create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "run-009",
      payload: {}
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain(PLAYWRIGHT_CREATE_RATE_LIMITED_REASON);
  });

  it("fails closed when Playwright launch raises an uncategorized error", async () => {
    launchPersistentContextMock.mockRejectedValue(new Error("browser launch failed"));
    const driver = new PlaywrightSunoDriver(".openclaw-browser-profiles/suno", "skip");

    const result = await driver.create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "run-010",
      payload: {}
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("playwright_create_failed: browser launch failed");
  });
});
