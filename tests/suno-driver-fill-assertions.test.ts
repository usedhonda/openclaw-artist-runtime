import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLAYWRIGHT_CREATE_SKIPPED_REASON,
  PlaywrightSunoDriver,
  SUNO_CREATE_URL,
  SUNO_LIBRARY_URL
} from "../src/services/sunoPlaywrightDriver";

const { chromiumMock, launchPersistentContextMock, stealthPluginMock, extractLyricsBodyMock } = vi.hoisted(() => ({
  chromiumMock: { use: vi.fn(), launchPersistentContext: vi.fn() },
  launchPersistentContextMock: vi.fn(),
  stealthPluginMock: vi.fn(() => ({})),
  extractLyricsBodyMock: vi.fn((value: string) => value)
}));

chromiumMock.launchPersistentContext = launchPersistentContextMock;

vi.mock("playwright-extra", () => ({ chromium: chromiumMock }));
vi.mock("puppeteer-extra-plugin-stealth", () => ({ default: stealthPluginMock }));
vi.mock("../src/services/lyricsExtraction.js", () => ({ extractLyricsBody: extractLyricsBodyMock }));

const lyricsSelector = 'textarea[data-testid="lyrics-textarea"]';
const styleSelector =
  '[data-testid="create-form-styles-wrapper"] textarea, textarea[placeholder="Describe the sound you want"], textarea[placeholder*="クラシック音楽"], textarea[placeholder*="バイキングメタル"], textarea[placeholder*="sound you want"]';
const titleSelector = 'input[placeholder="Song Title (Optional)"]:visible';
const excludeSelector = 'input[placeholder="Exclude styles"]';
const instrumentalSelector = 'button[aria-label="Check this to generate an instrumental only song"]';
const createSelector = 'button[aria-label="Create song"]';

function createLocator(selector: string, page: ReturnType<typeof pageMock>) {
  return {
    first: () => createLocator(selector, page),
    waitFor: vi.fn(async () => {
      page.waits.push(selector);
      if (page.visible[selector] === false) {
        throw new Error(`not visible: ${selector}`);
      }
    }),
    isVisible: vi.fn(async () => page.visible[selector] !== false),
    isEnabled: vi.fn(async () => page.enabled[selector] !== false),
    fill: vi.fn(async (value: string) => {
      page.fills.push({ selector, value });
      const sequence = page.reflectionSequences[selector];
      if (sequence && sequence.length > 0) {
        page.values[selector] = sequence.shift() ?? "";
        return;
      }
      page.values[selector] = value;
    }),
    click: vi.fn(async () => {
      page.clicks.push(selector);
    }),
    count: vi.fn(async () => page.counts[selector] ?? (selector === lyricsSelector ? 1 : 0)),
    getAttribute: vi.fn(async (name: string) => (name === "aria-pressed" ? (page.attributes[selector] ?? null) : null)),
    evaluate: vi.fn(async (_fn: (element: unknown, value?: string) => string, value?: string) => {
      page.dispatches.push({ selector, value: value ?? "" });
      return page.values[selector] ?? "";
    }),
    evaluateAll: vi.fn(async () => [])
  };
}

function pageMock(url = SUNO_CREATE_URL) {
  const page = {
    urlValue: url,
    values: {} as Record<string, string>,
    visible: {
      [lyricsSelector]: true,
      [styleSelector]: true,
      [titleSelector]: true,
      [excludeSelector]: true,
      [instrumentalSelector]: true
    } as Record<string, boolean>,
    enabled: {
      [instrumentalSelector]: true
    } as Record<string, boolean>,
    attributes: {
      [instrumentalSelector]: "false"
    } as Record<string, string | null>,
    counts: {
      [lyricsSelector]: 1
    } as Record<string, number>,
    reflectionSequences: {} as Record<string, string[]>,
    fills: [] as Array<{ selector: string; value: string }>,
    waits: [] as string[],
    dispatches: [] as Array<{ selector: string; value: string }>,
    clicks: [] as string[],
    goto: vi.fn(async (nextUrl: string) => {
      page.urlValue = nextUrl;
    }),
    waitForLoadState: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => undefined),
    content: vi.fn(async () => "<html></html>"),
    url: vi.fn(() => page.urlValue),
    bringToFront: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => ["https://suno.com/song/existing"]),
    locator: vi.fn((selector: string) => createLocator(selector, page))
  };
  return page;
}

function contextMock(pages: Array<ReturnType<typeof pageMock>>) {
  const fallbackPage = pages[0] ?? pageMock("about:blank");
  return {
    pages: vi.fn(() => pages),
    newPage: vi.fn(async () => fallbackPage),
    close: vi.fn(async () => undefined)
  };
}

describe("PlaywrightSunoDriver fill assertions", () => {
  beforeEach(() => {
    delete process.env.OPENCLAW_SUNO_USE_CDP;
    chromiumMock.use.mockReset();
    launchPersistentContextMock.mockReset();
    stealthPluginMock.mockClear();
    extractLyricsBodyMock.mockClear();
    extractLyricsBodyMock.mockImplementation((value: string) => value);
  });

  it("brings the highest-priority Suno create tab to front before using it", async () => {
    const first = pageMock("https://example.com/");
    const library = pageMock(SUNO_LIBRARY_URL);
    const suno = pageMock("https://suno.com/explore");
    const create = pageMock(`${SUNO_CREATE_URL}?wid=1`);
    launchPersistentContextMock.mockResolvedValue(contextMock([first, library, suno, create]));

    const result = await new PlaywrightSunoDriver(".profile", "skip").create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "priority-create",
      payload: { lyrics: "line one" }
    });

    expect(result.reason).toBe(PLAYWRIGHT_CREATE_SKIPPED_REASON);
    expect(create.bringToFront).toHaveBeenCalledTimes(1);
    expect(library.bringToFront).not.toHaveBeenCalled();
    expect(suno.bringToFront).not.toHaveBeenCalled();
    expect(first.bringToFront).not.toHaveBeenCalled();
    expect(create.goto).toHaveBeenCalledWith(SUNO_CREATE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    expect(create.goto).not.toHaveBeenCalledWith(SUNO_LIBRARY_URL, expect.anything());
  });

  it("falls back through library, any suno.com, then first page when selecting a tab", async () => {
    const first = pageMock("https://example.com/");
    const anySuno = pageMock("https://suno.com/explore");
    const library = pageMock(`${SUNO_LIBRARY_URL}?tab=songs`);

    launchPersistentContextMock.mockResolvedValueOnce(contextMock([first, anySuno, library]));
    await new PlaywrightSunoDriver(".profile", "skip").create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "priority-library",
      payload: {}
    });
    expect(library.bringToFront).toHaveBeenCalledTimes(1);

    launchPersistentContextMock.mockResolvedValueOnce(contextMock([first, anySuno]));
    await new PlaywrightSunoDriver(".profile", "skip").create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "priority-suno",
      payload: {}
    });
    expect(anySuno.bringToFront).toHaveBeenCalledTimes(1);

    launchPersistentContextMock.mockResolvedValueOnce(contextMock([first]));
    await new PlaywrightSunoDriver(".profile", "skip").create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "priority-first",
      payload: {}
    });
    expect(first.bringToFront).toHaveBeenCalledTimes(1);
  });

  it("waits for fields, dispatches input/change via evaluate, retries one reflected-value mismatch, and never clicks Create in skip mode", async () => {
    const page = pageMock();
    page.reflectionSequences[lyricsSelector] = ["stale lyric", "line one\nline two"];
    launchPersistentContextMock.mockResolvedValue(contextMock([page]));

    const result = await new PlaywrightSunoDriver(".profile", "skip").create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "fill-retry",
      payload: {
        payloadYaml: "line one\nline two",
        lyrics: "legacy should not win",
        styleAndFeel: "cold static folk",
        excludeStyles: "polished arena pop",
        songName: "Ash Radio",
        instrumental: true
      }
    });

    expect(result.reason).toBe(PLAYWRIGHT_CREATE_SKIPPED_REASON);
    expect(extractLyricsBodyMock).toHaveBeenCalledTimes(1);
    expect(extractLyricsBodyMock).toHaveBeenCalledWith("line one\nline two");
    expect(page.waits).toEqual(
      expect.arrayContaining([lyricsSelector, styleSelector, titleSelector, excludeSelector, instrumentalSelector])
    );
    expect(page.fills.filter((fill) => fill.selector === lyricsSelector)).toHaveLength(2);
    expect(page.fills).toContainEqual({ selector: styleSelector, value: "cold static folk" });
    expect(page.fills).toContainEqual({ selector: titleSelector, value: "Ash Radio" });
    expect(page.fills).toContainEqual({ selector: excludeSelector, value: "polished arena pop" });
    expect(page.dispatches.filter((entry) => entry.selector === lyricsSelector)).toHaveLength(2);
    expect(page.clicks).toContain(instrumentalSelector);
    expect(page.clicks).not.toContain(createSelector);
  });

  it("fails with a clear reflected-value mismatch after one retry", async () => {
    const page = pageMock();
    page.reflectionSequences[styleSelector] = ["wrong one", "wrong two"];
    launchPersistentContextMock.mockResolvedValue(contextMock([page]));

    const result = await new PlaywrightSunoDriver(".profile", "skip").create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "fill-mismatch",
      payload: {
        styleAndFeel: "expected style"
      }
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("suno_create_fill_mismatch: style");
    expect(page.fills.filter((fill) => fill.selector === styleSelector)).toHaveLength(2);
    expect(page.clicks).not.toContain(createSelector);
  });
});
