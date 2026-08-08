import { describe, expect, it } from "vitest";
import type { Page } from "playwright";
import {
  SUNO_CREATE_FALLBACKS,
  SUNO_CREATE_FORM_MISSING_REASON,
  SUNO_CREATE_SELECTORS,
  SUNO_EXPECTED_TAKE_COUNT,
  ensureSunoLyricsMode,
  filterFreshTakeUrls,
  resolveFirstVisibleLocator,
  waitForSunoCreateFormReady
} from "../src/services/sunoCreateForm";

type SelectorState = { visible: boolean; onClick?: () => void; attrs?: Record<string, string> };

/**
 * Minimal Playwright Page fake: each selector maps to a state. waitFor({visible})
 * resolves iff visible, else rejects immediately (models a timeout without waiting).
 * .first() is identity; .click() runs an optional side effect (e.g. mode flip).
 */
function makePage(states: Record<string, SelectorState>): { page: Page; clicks: string[] } {
  const clicks: string[] = [];
  const locatorFor = (selector: string) => {
    const state = states[selector] ?? { visible: false };
    const locator = {
      first: () => locator,
      isVisible: async () => state.visible,
      getAttribute: async (name: string) => state.attrs?.[name] ?? null,
      waitFor: async (_opts: { state: "visible"; timeout: number }) => {
        if (!state.visible) {
          throw new Error(`not visible: ${selector}`);
        }
      },
      click: async () => {
        clicks.push(selector);
        state.onClick?.();
      }
    };
    return locator;
  };
  const page = { locator: (selector: string) => locatorFor(selector) } as unknown as Page;
  return { page, clicks };
}

describe("resolveFirstVisibleLocator", () => {
  it("returns the first visible candidate in list order", async () => {
    const [c0, c1, c2] = SUNO_CREATE_FALLBACKS.createButton;
    const { page } = makePage({
      [c0]: { visible: false },
      [c1]: { visible: true },
      [c2]: { visible: true }
    });
    const locator = await resolveFirstVisibleLocator(
      page,
      SUNO_CREATE_FALLBACKS.createButton,
      50,
      "Create song button"
    );
    expect(await locator.isVisible()).toBe(true);
    // c1 is the first visible; c0 was skipped because it never became visible.
    const resolvedC1 = page.locator(c1).first();
    expect(await resolvedC1.isVisible()).toBe(true);
  });

  it("throws a DOM-missing error naming the tried candidates when none is visible", async () => {
    const { page } = makePage({});
    await expect(
      resolveFirstVisibleLocator(page, ["a.one", "b.two"], 10, "lyrics textarea")
    ).rejects.toThrow(new RegExp(`${SUNO_CREATE_FORM_MISSING_REASON}.*lyrics textarea.*a\\.one \\| b\\.two`));
  });
});

describe("waitForSunoCreateFormReady", () => {
  it("resolves when any single form-ready selector is visible", async () => {
    const { page } = makePage({
      [SUNO_CREATE_SELECTORS.createButton]: { visible: true }
    });
    await expect(waitForSunoCreateFormReady(page, 50)).resolves.toBeUndefined();
  });

  it("accepts the current plain-text Create button as a ready form signal", async () => {
    const plainCreate = 'button:has-text("Create")';
    const { page } = makePage({
      [plainCreate]: { visible: true }
    });
    await expect(waitForSunoCreateFormReady(page, 50)).resolves.toBeUndefined();
  });

  it("rejects with DOM-missing when no form-ready selector is visible", async () => {
    const { page } = makePage({});
    await expect(waitForSunoCreateFormReady(page, 10)).rejects.toThrow(SUNO_CREATE_FORM_MISSING_REASON);
  });
});

describe("filterFreshTakeUrls (take-attribution guard)", () => {
  const u = (n: number) => `https://suno.com/song/${n}`;

  it("returns new URLs not present in the baseline", () => {
    const baseline = new Set([u(1), u(2)]);
    const result = filterFreshTakeUrls([u(1), u(2), u(3), u(4)], baseline);
    expect(result.overCount).toBe(false);
    expect(result.urls.sort()).toEqual([u(3), u(4)].sort());
  });

  it("returns empty when nothing new appeared (still awaiting the real generation)", () => {
    const baseline = new Set([u(1), u(2)]);
    const result = filterFreshTakeUrls([u(1), u(2)], baseline);
    expect(result).toEqual({ urls: [], overCount: false });
  });

  it("rejects and flags overCount when more than the expected take count appears (workspace bleed)", () => {
    // The false-accepted bug: a captcha-blocked submit surfaced 14 unrelated workspace
    // songs. Anything beyond the expected take count must be rejected, not accepted.
    const bleed = Array.from({ length: 14 }, (_, i) => u(100 + i));
    const result = filterFreshTakeUrls(bleed, new Set(), SUNO_EXPECTED_TAKE_COUNT);
    expect(result).toEqual({ urls: [], overCount: true });
  });

  it("accepts exactly the expected take count", () => {
    const result = filterFreshTakeUrls([u(9), u(8)], new Set(), SUNO_EXPECTED_TAKE_COUNT);
    expect(result.overCount).toBe(false);
    expect(result.urls).toHaveLength(SUNO_EXPECTED_TAKE_COUNT);
  });
});

describe("ensureSunoLyricsMode", () => {
  it("returns the contenteditable lyrics editor directly when already visible", async () => {
    const { page, clicks } = makePage({
      [SUNO_CREATE_SELECTORS.lyricsEditor]: { visible: true }
    });
    const locator = await ensureSunoLyricsMode(page, 50);
    expect(await locator.isVisible()).toBe(true);
    expect(clicks).toHaveLength(0);
  });

  it("selects the Advanced tab to reveal the lyrics editor when it is hidden", async () => {
    const editorState: SelectorState = { visible: false };
    const { page, clicks } = makePage({
      [SUNO_CREATE_SELECTORS.lyricsEditor]: editorState,
      [SUNO_CREATE_SELECTORS.advancedTab]: {
        visible: true,
        attrs: { "aria-selected": "false" },
        onClick: () => {
          editorState.visible = true;
        }
      }
    });
    const locator = await ensureSunoLyricsMode(page, 50);
    expect(clicks).toContain(SUNO_CREATE_SELECTORS.advancedTab);
    expect(await locator.isVisible()).toBe(true);
  });

  it("uses the current plain-text Advanced button when no tab aria metadata exists", async () => {
    const editorState: SelectorState = { visible: false };
    const plainAdvanced = 'button:has-text("Advanced")';
    const { page, clicks } = makePage({
      [SUNO_CREATE_SELECTORS.lyricsEditor]: editorState,
      [plainAdvanced]: {
        visible: true,
        onClick: () => {
          editorState.visible = true;
        }
      }
    });
    const locator = await ensureSunoLyricsMode(page, 50);
    expect(clicks).toContain(plainAdvanced);
    expect(await locator.isVisible()).toBe(true);
  });

  it("selects Custom inside Advanced before waiting for the current lyrics editor", async () => {
    const editorState: SelectorState = { visible: false };
    const customMode = 'button:has-text("Custom")';
    const { page, clicks } = makePage({
      [SUNO_CREATE_SELECTORS.lyricsEditor]: editorState,
      [SUNO_CREATE_SELECTORS.advancedTab]: { visible: true, attrs: { "aria-selected": "true" } },
      [customMode]: {
        visible: true,
        onClick: () => {
          editorState.visible = true;
        }
      }
    });

    const locator = await ensureSunoLyricsMode(page, 50);
    expect(clicks).toEqual([customMode]);
    expect(await locator.isVisible()).toBe(true);
  });

  it("does not re-click the Advanced tab when it is already selected", async () => {
    // Advanced already selected but editor still resolving: must not toggle it off.
    const { page, clicks } = makePage({
      [SUNO_CREATE_SELECTORS.lyricsEditor]: { visible: false },
      [`[role="textbox"][aria-label="Lyrics editor"]`]: { visible: true },
      [SUNO_CREATE_SELECTORS.advancedTab]: { visible: true, attrs: { "aria-selected": "true" } }
    });
    const locator = await ensureSunoLyricsMode(page, 50);
    expect(clicks).toHaveLength(0);
    expect(await locator.isVisible()).toBe(true);
  });
});
