import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSunoPromptPack } from "../src/suno-production/generatePromptPack";
import { PlaywrightSunoDriver } from "../src/services/sunoPlaywrightDriver";

const { chromiumMock, launchPersistentContextMock, stealthPluginMock } = vi.hoisted(() => ({
  chromiumMock: { use: vi.fn(), launchPersistentContext: vi.fn() },
  launchPersistentContextMock: vi.fn(),
  stealthPluginMock: vi.fn(() => ({}))
}));

chromiumMock.launchPersistentContext = launchPersistentContextMock;

vi.mock("playwright-extra", () => ({ chromium: chromiumMock }));
vi.mock("puppeteer-extra-plugin-stealth", () => ({ default: stealthPluginMock }));

const lyricsSelector = 'textarea[data-testid="lyrics-textarea"]';

function pageMock() {
  const fills: Array<{ selector: string; value: string }> = [];
  return {
    fills,
    goto: vi.fn(async () => undefined),
    waitForLoadState: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    bringToFront: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => undefined),
    content: vi.fn(async () => "<html></html>"),
    url: vi.fn(() => "https://suno.com/create"),
    evaluate: vi.fn(async () => []),
    locator: vi.fn((selector: string) => ({
      first: () => ({
        waitFor: vi.fn(async () => undefined),
        isVisible: vi.fn(async () => true),
        isEnabled: vi.fn(async () => true),
        fill: vi.fn(async (value: string) => fills.push({ selector, value })),
        click: vi.fn(async () => undefined),
        count: vi.fn(async () => 1),
        getAttribute: vi.fn(async () => "false"),
        evaluate: vi.fn(async (_callback: unknown, value: string) => value),
        evaluateAll: vi.fn(async () => [])
      }),
      waitFor: vi.fn(async () => undefined),
      isVisible: vi.fn(async () => true),
      isEnabled: vi.fn(async () => true),
      fill: vi.fn(async (value: string) => fills.push({ selector, value })),
      click: vi.fn(async () => undefined),
      count: vi.fn(async () => 1),
      getAttribute: vi.fn(async () => "false"),
      evaluate: vi.fn(async (_callback: unknown, value: string) => value),
      evaluateAll: vi.fn(async () => [])
    }))
  };
}

describe("Suno double-entry submission", () => {
  beforeEach(() => {
    delete process.env.OPENCLAW_SUNO_USE_CDP;
    launchPersistentContextMock.mockReset();
  });

  it("submits META plus lyrics payloadYaml without stripping the do-not-sing guard", async () => {
    const pack = createSunoPromptPack({
      songId: "song-double",
      songTitle: "Double Entry",
      artistReason: "test double entry",
      lyricsText: "[Verse 1]\nあめのなかで きみをまつ\n[Hook]\nあめだけのこる",
      artistSnapshot: "# ARTIST\nused::honda",
      currentStateSnapshot: "# CURRENT\n"
    });
    const page = pageMock();
    launchPersistentContextMock.mockResolvedValue({
      pages: vi.fn(() => [page]),
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined)
    });

    await new PlaywrightSunoDriver(".profile", "skip").create({
      dryRun: false,
      authority: "auto_create_and_select_take",
      runId: "run-double",
      payload: pack.payload
    });

    const submitted = page.fills.find((fill) => fill.selector === lyricsSelector)?.value;
    expect(submitted).toBe(pack.yamlLyrics);
    expect(submitted).toContain("# META (hints; do not sing)");
    expect(submitted).toContain("=== LYRICS START (do not sing tags) ===");
    expect(submitted).toContain("[Verse 1 - dense rap, male vocal]");
    expect(submitted?.length).toBeLessThanOrEqual(5000);
    expect(String(pack.payload.lyrics)).not.toContain("# META");
    expect(String(pack.payload.lyrics)).not.toContain("LYRICS START");
  });
});
