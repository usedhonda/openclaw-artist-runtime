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
  PLAYWRIGHT_CREATE_SNAPSHOT_RECOVERY_REASON,
  PLAYWRIGHT_CREATE_SKIPPED_REASON,
  PLAYWRIGHT_CREATE_TIMEOUT_REASON,
  PLAYWRIGHT_LIVE_TIMEOUT_REASON,
  PLAYWRIGHT_TITLE_REQUIRED_REASON,
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
  const librarySnapshots: string[][] = [];
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
    librarySnapshots,
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
      // A comma-joined locator (e.g. the create-form-ready guard) is visible when any of
      // its constituent selectors is visible, mirroring real Playwright CSS-list semantics.
      const anyVisible = () => selector.split(",").some((part) => visible[part.trim()] ?? false);
      return {
      first: () => ({
        isVisible: vi.fn(async () => anyVisible()),
        waitFor: vi.fn(async () => {
          if (anyVisible()) {
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
      evaluateAll: vi.fn(async () => selector === 'a[href*="/song/"]'
        ? librarySnapshots.shift() ?? []
        : createCardSnapshots.shift() ?? [])
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
    expect(page.goto).toHaveBeenNthCalledWith(1, SUNO_CREATE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    expect(page.goto).not.toHaveBeenCalledWith(SUNO_LIBRARY_URL, expect.anything());
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
    // Form shell rendered (styles wrapper visible) but the lyrics textarea/toggle are hidden,
    // so the create-form-ready guard passes and ensureLyricsMode exercises the "toggle hidden" branch.
    page.visible["[data-testid=\"create-form-styles-wrapper\"]"] = true;
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
    page.createCardSnapshots.push([], ["https://suno.com/song/new-1", "https://suno.com/song/new-2"]);
    launchPersistentContextMock.mockResolvedValue(context);
    const driver = new PlaywrightSunoDriver(
      ".openclaw-browser-profiles/suno",
      "live",
      mkdtempSync(join(tmpdir(), "artist-runtime-suno-create-timeout-")),
      { intervalMs: 1, timeoutMs: 3, createCardTimeoutMs: 2 }
    );

    const result = await driver.create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "run-003",
      payload: {
        songName: "Run 003",
        lyrics: "line one"
      }
    });

    expect(result).toEqual({
      accepted: true,
      runId: "run-003",
      reason: PLAYWRIGHT_CREATE_CARD_REASON,
      urls: ["https://suno.com/song/new-1", "https://suno.com/song/new-2"],
      lyricsTelemetry: {
        bareLyricsChars: 8,
        markerChars: 0,
        submittedPayloadChars: 8,
        effectiveLyricsBoxLimit: 4800,
        textareaMaxLength: undefined,
        textareaReadbackChars: 8,
        readbackMatches: true
      },
      dryRun: false
    });
    expect(page.clicks).toContain("button[aria-label=\"Create song\"]");
    expect(page.goto).not.toHaveBeenCalledWith(SUNO_LIBRARY_URL, expect.anything());
  });

  it("fails closed before clicking Create when live mode payload has no title", async () => {
    const { page, context } = createContext();
    launchPersistentContextMock.mockResolvedValue(context);
    const driver = new PlaywrightSunoDriver(".openclaw-browser-profiles/suno", "live", ".", {
      intervalMs: 1,
      timeoutMs: 3,
      createCardTimeoutMs: 1
    });

    const result = await driver.create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "run-title-required",
      payload: {
        lyrics: "line one"
      }
    });

    expect(result).toMatchObject({
      accepted: false,
      runId: "run-title-required",
      reason: PLAYWRIGHT_TITLE_REQUIRED_REASON,
      urls: []
    });
    expect(page.clicks).not.toContain("button[aria-label=\"Create song\"]");
  });

  it("returns accepted from create-card polling without library fallback", async () => {
    const { page, context } = createContext();
    page.createCardSnapshots.push(
      ["https://suno.com/song/existing-1"],
      [
        "https://suno.com/song/existing-1",
        "https://suno.com/song/new-card-1",
        "https://suno.com/song/new-card-2"
      ]
    );
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
        songName: "Run 003b",
        lyrics: "line one"
      }
    });

    expect(result).toEqual({
      accepted: true,
      runId: "run-003b",
      reason: PLAYWRIGHT_CREATE_CARD_REASON,
      urls: ["https://suno.com/song/new-card-1", "https://suno.com/song/new-card-2"],
      lyricsTelemetry: {
        bareLyricsChars: 8,
        markerChars: 0,
        submittedPayloadChars: 8,
        effectiveLyricsBoxLimit: 4800,
        textareaMaxLength: undefined,
        textareaReadbackChars: 8,
        readbackMatches: true
      },
      dryRun: false
    });
    expect(page.clicks).toContain("button[aria-label=\"Create song\"]");
    expect(page.goto.mock.calls.filter(([url]) => url === SUNO_LIBRARY_URL)).toHaveLength(0);
  });

  it("waits for a staggered second create-card URL before returning", async () => {
    const { page, context } = createContext();
    page.createCardSnapshots.push(
      [],
      ["https://suno.com/song/new-1"],
      ["https://suno.com/song/new-1", "https://suno.com/song/new-2"]
    );
    launchPersistentContextMock.mockResolvedValue(context);
    const driver = new PlaywrightSunoDriver(
      ".openclaw-browser-profiles/suno",
      "live",
      mkdtempSync(join(tmpdir(), "artist-runtime-suno-create-staggered-")),
      { intervalMs: 1, timeoutMs: 5, createCardTimeoutMs: 3 }
    );

    const result = await driver.create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "run-staggered",
      payload: {
        songName: "Run Staggered",
        lyrics: "line one"
      }
    });

    expect(result).toMatchObject({
      accepted: true,
      runId: "run-staggered",
      reason: PLAYWRIGHT_CREATE_CARD_REASON,
      urls: ["https://suno.com/song/new-1", "https://suno.com/song/new-2"],
      dryRun: false
    });
    expect(page.goto.mock.calls.filter(([url]) => url === SUNO_LIBRARY_URL)).toHaveLength(0);
  });

  it("ignores create-card URLs already present in the baseline and fails closed when library has no new title URLs", async () => {
    const { page, context } = createContext();
    page.createCardSnapshots.push(
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
      runId: "run-003bb",
      payload: {
        songName: "Run 003bb",
        lyrics: "line one"
      }
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain(PLAYWRIGHT_LIVE_TIMEOUT_REASON);
    expect(result.reason).toContain("bestUrlCount=0");
    expect(result.reason).toContain("selectorMatchedCount=");
    expect(result.reason).toContain("expectedCount=2");
    expect(result.reason).toContain("titleMatched=false");
    expect(page.goto.mock.calls.filter(([url]) => url === SUNO_LIBRARY_URL).length).toBeGreaterThan(0);
  });

  it("includes partial create-card diagnostics when only one new URL appears", async () => {
    const { page, context } = createContext();
    page.counts[`button[aria-label^="Play "]`] = 1;
    page.createCardSnapshots.push(
      ["https://suno.com/song/existing-1"],
      ["https://suno.com/song/existing-1", "https://suno.com/song/new-only-one"]
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
      runId: "run-partial-card",
      payload: {
        songName: "Run Partial",
        lyrics: "line one"
      }
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain(PLAYWRIGHT_LIVE_TIMEOUT_REASON);
    expect(result.reason).toContain("bestUrlCount=1");
    expect(result.reason).toContain("selectorMatchedCount=1");
    expect(result.reason).toContain("expectedCount=2");
    expect(result.reason).toContain("titleMatched=true");
  });

  it("keeps create-card polling scoped to completed clip rows", async () => {
    const { page, context } = createContext();
    page.createCardSnapshots.push([], []);
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
        songName: "Run 003bd",
        lyrics: "line one"
      }
    });

    const createCardSelector = page.selectors.find((selector) => selector.includes("Run 003bd"));
    // Title-scoped to the finished-song play button on the create page (Suno's current
    // DOM), including Suno's "from start" aria-label suffix.
    expect(createCardSelector).toBe("[aria-label=\"Play Run 003bd\"], [aria-label^=\"Play Run 003bd \"]");
    expect(createCardSelector).not.toContain("generation-card");
    expect(createCardSelector).not.toContain("generating");
    expect(result.reason).toContain(PLAYWRIGHT_LIVE_TIMEOUT_REASON);
    expect(result.urls).toEqual([]);
    expect(page.goto.mock.calls.filter(([url]) => url === SUNO_LIBRARY_URL).length).toBeGreaterThan(0);
  });

  it("polls the library for the latest two title-matched songs when create cards are stale", async () => {
    const { page, context } = createContext();
    page.createCardSnapshots.push(
      ["https://suno.com/song/existing-1"],
      ["https://suno.com/song/existing-1", "https://suno.com/song/stale-single"]
    );
    page.librarySnapshots.push(
      [],
      [
        "https://suno.com/song/library-new-1",
        "https://suno.com/song/library-new-2",
        "https://suno.com/song/existing-1"
      ]
    );
    launchPersistentContextMock.mockResolvedValue(context);
    const driver = new PlaywrightSunoDriver(
      ".openclaw-browser-profiles/suno",
      "live",
      ".",
      { intervalMs: 1, timeoutMs: 5, createCardTimeoutMs: 2 }
    );

    const result = await driver.create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "run-003c",
      payload: {
        songName: "Run 003c",
        lyrics: "line one"
      }
    });

    expect(result).toMatchObject({
      accepted: true,
      reason: PLAYWRIGHT_CREATE_SNAPSHOT_RECOVERY_REASON,
      urls: ["https://suno.com/song/library-new-1", "https://suno.com/song/library-new-2"]
    });
    expect(page.waitForTimeout).not.toHaveBeenCalled();
    expect(page.goto.mock.calls.filter(([url]) => url === SUNO_LIBRARY_URL).length).toBeGreaterThan(0);
  });

  it("recovers title-scoped Suno URLs from the current page before reporting timeout", async () => {
    const { page, context } = createContext();
    page.createCardSnapshots.push([], [], []);
    page.content.mockResolvedValue(`
      <html>
        <body>
          <section>
            <button aria-label="Play Run Snapshot from start">Run Snapshot</button>
            <img src="https://cdn2.suno.ai/image_large_44444444-4444-4444-8444-444444444444.jpeg">
          </section>
          <section>
            <button aria-label="Play Run Snapshot from start">Run Snapshot</button>
            <img src="https://cdn2.suno.ai/image_large_55555555-5555-4555-8555-555555555555.jpeg">
          </section>
        </body>
      </html>
    `);
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
      runId: "run-snapshot",
      payload: {
        songName: "Run Snapshot",
        lyrics: "line one"
      }
    });

    expect(result).toMatchObject({
      accepted: true,
      runId: "run-snapshot",
      reason: PLAYWRIGHT_CREATE_SNAPSHOT_RECOVERY_REASON,
      urls: [
        "https://suno.com/song/44444444-4444-4444-8444-444444444444",
        "https://suno.com/song/55555555-5555-4555-8555-555555555555"
      ],
      dryRun: false
    });
    expect(page.screenshot).not.toHaveBeenCalled();
    expect(page.goto.mock.calls.filter(([url]) => url === SUNO_LIBRARY_URL).length).toBeGreaterThan(0);
  });

  it("times out in live mode when no new song URLs appear", async () => {
    const { page, context } = createContext();
    page.createCardSnapshots.push([], [], []);
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
        songName: "Run 004",
        lyrics: "line one"
      }
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain(PLAYWRIGHT_LIVE_TIMEOUT_REASON);
    expect(result.reason).toContain("bestUrlCount=0");
    expect(result.reason).toContain("expectedCount=2");
    expect(result.reason).toContain("titleMatched=false");
    expect(page.clicks).toContain("button[aria-label=\"Create song\"]");
    expect(page.waitForTimeout).not.toHaveBeenCalled();
    expect(page.goto.mock.calls.filter(([url]) => url === SUNO_LIBRARY_URL).length).toBeGreaterThan(0);
  });

  it("times out when create-card polling finds no new songs", async () => {
    const { page, context } = createContext();
    page.createCardSnapshots.push([], [], []);
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
        songName: "Run 004b",
        lyrics: "line one"
      }
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain(PLAYWRIGHT_LIVE_TIMEOUT_REASON);
    expect(page.clicks).toContain("button[aria-label=\"Create song\"]");
    expect(page.waitForTimeout).not.toHaveBeenCalled();
    expect(page.goto.mock.calls.filter(([url]) => url === SUNO_LIBRARY_URL).length).toBeGreaterThan(0);
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
