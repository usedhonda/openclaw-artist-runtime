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
    evaluate: vi.fn(async () => []),
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

async function filledLyrics(payload: Record<string, unknown>): Promise<string | undefined> {
  const page = pageMock();
  launchPersistentContextMock.mockResolvedValue({
    pages: vi.fn(() => [page]),
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined)
  });
  await new PlaywrightSunoDriver(".profile", "skip").create({
    dryRun: false,
    authority: "auto_create_and_select_take",
    runId: "run-contract",
    payload
  });
  return page.fills.find((fill) => fill.selector === "textarea[data-testid=\"lyrics-textarea\"]")?.value;
}

describe("Suno driver payload contract", () => {
  beforeEach(() => {
    delete process.env.OPENCLAW_SUNO_USE_CDP;
    launchPersistentContextMock.mockReset();
  });

  it("prefers payload.lyrics when lyrics and lyricsText both exist", async () => {
    await expect(filledLyrics({
      lyrics: "meta:\n  title: YAML first\nlyrics:\n  - canonical",
      lyricsText: "[Verse]\nplain fallback"
    })).resolves.toBe("meta:\n  title: YAML first\nlyrics:\n  - canonical");
  });

  it("uses payload.lyricsText only when payload.lyrics is missing", async () => {
    await expect(filledLyrics({ lyricsText: "[Verse]\nplain fallback" })).resolves.toBe("[Verse]\nplain fallback");
  });

  it("uses payload.lyricsText when payload.lyrics is blank", async () => {
    await expect(filledLyrics({ lyrics: "  ", lyricsText: "[Chorus]\nplain fallback" })).resolves.toBe("[Chorus]\nplain fallback");
  });
});
