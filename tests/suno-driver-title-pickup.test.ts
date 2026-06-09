import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLAYWRIGHT_CREATE_CARD_REASON,
  PLAYWRIGHT_LIVE_TIMEOUT_REASON,
  PlaywrightSunoDriver,
  SUNO_CREATE_URL
} from "../src/services/sunoPlaywrightDriver";

const { chromiumMock, launchPersistentContextMock, stealthPluginMock } = vi.hoisted(() => ({
  chromiumMock: { use: vi.fn(), launchPersistentContext: vi.fn() },
  launchPersistentContextMock: vi.fn(),
  stealthPluginMock: vi.fn(() => ({}))
}));

chromiumMock.launchPersistentContext = launchPersistentContextMock;

vi.mock("playwright-extra", () => ({ chromium: chromiumMock }));
vi.mock("puppeteer-extra-plugin-stealth", () => ({ default: stealthPluginMock }));

function pageMock() {
  const selectors: string[] = [];
  const snapshots = [
    ["https://suno.com/song/existing"],
    ["https://suno.com/song/existing", "https://suno.com/song/new-title-match"]
  ];
  return {
    selectors,
    goto: vi.fn(async () => undefined),
    waitForLoadState: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => undefined),
    content: vi.fn(async () => "<html></html>"),
    url: vi.fn(() => SUNO_CREATE_URL),
    evaluate: vi.fn(async () => ["https://suno.com/song/existing"]),
    locator: vi.fn((selector: string) => {
      selectors.push(selector);
      return {
        first: () => ({
          waitFor: vi.fn(async () => undefined),
          isVisible: vi.fn(async () => true),
          fill: vi.fn(async () => undefined)
        }),
        fill: vi.fn(async () => undefined),
        click: vi.fn(async () => undefined),
        count: vi.fn(async () => 1),
        getAttribute: vi.fn(async () => "false"),
        evaluateAll: vi.fn(async () => snapshots.shift() ?? [])
      };
    })
  };
}

describe("Suno driver title-based pickup", () => {
  beforeEach(() => {
    delete process.env.OPENCLAW_SUNO_USE_CDP;
    launchPersistentContextMock.mockReset();
  });

  it("filters completed clip rows by aria-label title before accepting URLs", async () => {
    const page = pageMock();
    launchPersistentContextMock.mockResolvedValue({
      pages: vi.fn(() => [page]),
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined)
    });

    const result = await new PlaywrightSunoDriver(".profile", "live", ".", {
      intervalMs: 1,
      timeoutMs: 2,
      createCardTimeoutMs: 1
    }).create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "run-pickup",
      payload: {
        songName: "Watapp Groups",
        lyricsText: "plain lyric"
      }
    });

    expect(result.reason).toBe(PLAYWRIGHT_CREATE_CARD_REASON);
    expect(result.urls).toEqual(["https://suno.com/song/new-title-match"]);
    expect(page.selectors).toContain("button[aria-label=\"Play Watapp Groups\"]");
    expect(page.selectors).toContain("button[aria-label^=\"Play \"]");
  });

  it("fails closed instead of falling back to unrelated completed cards when title mismatch remains", async () => {
    const selectors: string[] = [];
    const snapshotsBySelector = new Map<string, string[][]>([
      [
        "[data-testid=\"clip-row\"][data-clip-status=\"complete\"][aria-label=\"Mijikai Kage\"] a[href*='/song/']",
        [[], []]
      ],
      [
        "[data-testid=\"clip-row\"][data-clip-status=\"complete\"] a[href*='/song/']",
        [["https://suno.com/song/existing"], ["https://suno.com/song/existing", "https://suno.com/song/renamed-by-suno"]]
      ]
    ]);
    const page = {
      selectors,
      goto: vi.fn(async () => undefined),
      waitForLoadState: vi.fn(async () => undefined),
      screenshot: vi.fn(async () => undefined),
      content: vi.fn(async () => "<html></html>"),
      url: vi.fn(() => SUNO_CREATE_URL),
      locator: vi.fn((selector: string) => {
        selectors.push(selector);
        return {
          first: () => ({
            waitFor: vi.fn(async () => undefined),
            isVisible: vi.fn(async () => true),
            fill: vi.fn(async () => undefined)
          }),
          fill: vi.fn(async () => undefined),
          click: vi.fn(async () => undefined),
          count: vi.fn(async () => 1),
          getAttribute: vi.fn(async () => "false"),
          evaluateAll: vi.fn(async () => snapshotsBySelector.get(selector)?.shift() ?? [])
        };
      })
    };
    launchPersistentContextMock.mockResolvedValue({
      pages: vi.fn(() => [page]),
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined)
    });

    const result = await new PlaywrightSunoDriver(".profile", "live", ".", {
      intervalMs: 1,
      timeoutMs: 2,
      createCardTimeoutMs: 2
    }).create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "run-renamed",
      payload: {
        songName: "Mijikai Kage",
        lyricsText: "plain lyric"
      }
    });

    expect(result.reason).toBe(PLAYWRIGHT_LIVE_TIMEOUT_REASON);
    expect(result.urls).toEqual([]);
    expect(page.selectors).toContain("button[aria-label=\"Play Mijikai Kage\"]");
    expect(page.selectors.filter((selector) => selector === "button[aria-label^=\"Play \"]")).toHaveLength(1);
  });
});
