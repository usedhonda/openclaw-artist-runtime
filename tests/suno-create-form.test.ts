import { describe, expect, it } from "vitest";
import type { Page } from "playwright";
import {
  SUNO_CREATE_FALLBACKS,
  SUNO_CREATE_FORM_MISSING_REASON,
  SUNO_CREATE_SELECTORS,
  ensureSunoLyricsMode,
  resolveFirstVisibleLocator,
  waitForSunoCreateFormReady
} from "../src/services/sunoCreateForm";

type SelectorState = { visible: boolean; onClick?: () => void };

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

  it("rejects with DOM-missing when no form-ready selector is visible", async () => {
    const { page } = makePage({});
    await expect(waitForSunoCreateFormReady(page, 10)).rejects.toThrow(SUNO_CREATE_FORM_MISSING_REASON);
  });
});

describe("ensureSunoLyricsMode", () => {
  it("returns the lyrics textarea directly when already visible (custom mode)", async () => {
    const { page, clicks } = makePage({
      [SUNO_CREATE_SELECTORS.lyricsTextarea]: { visible: true }
    });
    const locator = await ensureSunoLyricsMode(page, 50);
    expect(await locator.isVisible()).toBe(true);
    expect(clicks).toHaveLength(0);
  });

  it("clicks 'Add your own lyrics' to mount the textarea when in Simple mode", async () => {
    const lyricsState: SelectorState = { visible: false };
    const { page, clicks } = makePage({
      [SUNO_CREATE_SELECTORS.lyricsTextarea]: lyricsState,
      [SUNO_CREATE_SELECTORS.addLyricsButton]: {
        visible: true,
        onClick: () => {
          lyricsState.visible = true;
        }
      }
    });
    const locator = await ensureSunoLyricsMode(page, 50);
    expect(clicks).toContain(SUNO_CREATE_SELECTORS.addLyricsButton);
    expect(await locator.isVisible()).toBe(true);
  });
});
