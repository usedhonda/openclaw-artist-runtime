import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlaywrightSunoDriver, SUNO_CREATE_URL } from "../src/services/sunoPlaywrightDriver";

const { chromiumMock, launchPersistentContextMock, stealthPluginMock } = vi.hoisted(() => ({
  chromiumMock: { use: vi.fn(), launchPersistentContext: vi.fn() },
  launchPersistentContextMock: vi.fn(),
  stealthPluginMock: vi.fn(() => ({}))
}));

chromiumMock.launchPersistentContext = launchPersistentContextMock;

vi.mock("playwright-extra", () => ({ chromium: chromiumMock }));
vi.mock("puppeteer-extra-plugin-stealth", () => ({ default: stealthPluginMock }));

function pageMock() {
  const fills: Array<{ selector: string; value: string }> = [];
  const page = {
    fills,
    goto: vi.fn(async () => undefined),
    waitForLoadState: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => undefined),
    content: vi.fn(async () => "<html></html>"),
    url: vi.fn(() => SUNO_CREATE_URL),
    evaluate: vi.fn(async () => ["https://suno.com/song/existing"]),
    locator: vi.fn((selector: string) => ({
      first: () => ({
        waitFor: vi.fn(async () => undefined),
        isVisible: vi.fn(async () => true),
        fill: vi.fn(async (value: string) => fills.push({ selector, value }))
      }),
      fill: vi.fn(async (value: string) => fills.push({ selector, value })),
      click: vi.fn(async () => undefined),
      count: vi.fn(async () => 1),
      getAttribute: vi.fn(async () => "false"),
      evaluateAll: vi.fn(async () => [])
    }))
  };
  return page;
}

describe("Suno driver title fill", () => {
  beforeEach(() => {
    delete process.env.OPENCLAW_SUNO_USE_CDP;
    launchPersistentContextMock.mockReset();
  });

  it("fills songName into the optional title input and uses plain lyricsText", async () => {
    const page = pageMock();
    launchPersistentContextMock.mockResolvedValue({
      pages: vi.fn(() => [page]),
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined)
    });

    await new PlaywrightSunoDriver(".profile", "skip").create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "run-title",
      payload: {
        songName: "Dead Neon Clock",
        lyricsText: "plain lyric",
        lyrics: "title: Dead Neon Clock\nsections:\n  - yaml fallback"
      }
    });

    expect(page.fills).toContainEqual({
      selector: "input[placeholder=\"Song Title (Optional)\"]",
      value: "Dead Neon Clock"
    });
    expect(page.fills).toContainEqual({
      selector: "textarea[data-testid=\"lyrics-textarea\"]",
      value: "plain lyric"
    });
    expect(page.fills).not.toContainEqual({
      selector: "textarea[data-testid=\"lyrics-textarea\"]",
      value: "title: Dead Neon Clock\nsections:\n  - yaml fallback"
    });
  });
});
