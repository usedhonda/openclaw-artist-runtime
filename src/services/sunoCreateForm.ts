import type { Locator, Page } from "playwright";

/**
 * Single source of truth for suno.com/create form selectors and the small DOM
 * interactions shared by the two live Suno lanes (PlaywrightSunoDriver and
 * CdpHumanAssistDriver).
 *
 * Suno's create UI is relabeled often, so every field is resolved through an
 * ordered fallback list (data-testid -> aria-label -> placeholder/text/structure)
 * rather than a single brittle selector. Keeping both lanes on this module means a
 * UI relabel is fixed once, not per driver.
 *
 * Critical detail: the create page opens in "Simple" mode where the lyrics
 * textarea is NOT mounted. The lyrics box only appears after switching to the
 * custom/"Add your own lyrics" mode. A driver that fills the lyrics textarea
 * without that switch times out because the element never renders (the exact
 * `open_fill_failed:locator.fill: Timeout` seen on the human-assist lane).
 */

export const SUNO_CREATE_SELECTORS = {
  createButton: 'button[aria-label="Create song"]',
  // Suno v5.5 replaced the plain lyrics <textarea data-testid="lyrics-textarea"> with a
  // rich contenteditable editor (role=textbox, aria-label="Lyrics editor"). The old
  // textarea no longer exists; the visible "Cowriter prompt" textarea is the AI co-writer
  // chat, NOT the lyrics body, so it must never be targeted for lyrics.
  lyricsEditor: 'div[role="textbox"][aria-label="Lyrics editor"]',
  lyricsTextarea: 'textarea[data-testid="lyrics-textarea"]',
  // The lyrics editor lives in the "Advanced" create tab. Selecting it reveals the editor
  // (the older "Add your own lyrics" custom-mode toggle is gone from v5.5).
  advancedTab: 'button[role="tab"][aria-label="Advanced"]',
  addLyricsButton: 'button[aria-label="Add your own lyrics"]',
  stylesWrapper: '[data-testid="create-form-styles-wrapper"]',
  titleInput: 'input[placeholder="Song Title (Optional)"]:visible',
  excludeInput: 'input[placeholder="Exclude styles"]'
} as const;

/**
 * Ordered fallback candidates per field. First visible match wins. Order is
 * strongest-signal-first: stable data-testid, then aria-label, then
 * placeholder/text/structure that survives a relabel of the primary hook.
 */
export const SUNO_CREATE_FALLBACKS = {
  createButton: [
    SUNO_CREATE_SELECTORS.createButton,
    'button[aria-label*="Create song"]',
    'button[aria-label^="Create"]',
    'button:has-text("Create")'
  ],
  // Lyrics body input. v5.5 contenteditable editor first, legacy textarea last.
  lyricsEditor: [
    SUNO_CREATE_SELECTORS.lyricsEditor,
    '[role="textbox"][aria-label="Lyrics editor"]',
    '[contenteditable="true"].lyrics-editor-content',
    '[role="textbox"][aria-label*="Lyric" i]',
    SUNO_CREATE_SELECTORS.lyricsTextarea
  ],
  // Reveal the lyrics editor. v5.5 Advanced tab first, legacy custom-mode toggle last.
  advancedTab: [
    SUNO_CREATE_SELECTORS.advancedTab,
    '[role="tab"][aria-label="Advanced"]',
    SUNO_CREATE_SELECTORS.addLyricsButton,
    'button:has-text("Add your own lyrics")'
  ],
  style: [
    '[data-testid="create-form-styles-wrapper"] textarea',
    'textarea[placeholder="Describe the sound you want"]',
    'textarea[placeholder*="クラシック音楽"]',
    'textarea[placeholder*="バイキングメタル"]',
    'textarea[placeholder*="sound you want"]'
  ],
  titleInput: [SUNO_CREATE_SELECTORS.titleInput, 'input[placeholder*="Song Title"]:visible'],
  excludeInput: [SUNO_CREATE_SELECTORS.excludeInput, 'input[placeholder*="Exclude"]']
} as const;

/**
 * Selectors that, when ANY one is visible, prove the create form has rendered
 * past the Clerk `__clerk_handshake` skeleton. Used by both lanes' form-ready gate.
 */
export const SUNO_CREATE_FORM_READY_SELECTORS: readonly string[] = [
  SUNO_CREATE_SELECTORS.lyricsEditor,
  SUNO_CREATE_SELECTORS.advancedTab,
  SUNO_CREATE_SELECTORS.lyricsTextarea,
  SUNO_CREATE_SELECTORS.addLyricsButton,
  SUNO_CREATE_SELECTORS.stylesWrapper,
  SUNO_CREATE_SELECTORS.createButton
];

/** Comma-joined style selector kept for callers that want one locator string. */
export const SUNO_STYLE_SELECTOR = SUNO_CREATE_FALLBACKS.style.join(", ");

export const SUNO_CREATE_FORM_MISSING_REASON = "suno_create_dom_missing";

/**
 * Resolve the first candidate selector whose first match becomes visible within
 * `timeoutMs`. Candidates race concurrently so a hidden-but-present element does
 * not block a sibling that is already visible. Throws with a diagnostic listing
 * the tried candidates if none appears.
 */
export async function resolveFirstVisibleLocator(
  page: Page,
  candidates: readonly string[],
  timeoutMs: number,
  fieldName: string
): Promise<Locator> {
  const attempts = candidates.map(
    (selector) =>
      new Promise<string>((resolve, reject) => {
        page
          .locator(selector)
          .first()
          .waitFor({ state: "visible", timeout: timeoutMs })
          .then(() => resolve(selector))
          .catch((error) => reject(error));
      })
  );
  try {
    const selector = await Promise.any(attempts);
    return page.locator(selector).first();
  } catch {
    throw new Error(
      `${SUNO_CREATE_FORM_MISSING_REASON}: ${fieldName} not visible within ${timeoutMs}ms; tried ${candidates.join(" | ")}`
    );
  }
}

/**
 * Wait until the create form has rendered (any form-ready selector visible),
 * tolerating the Clerk handshake skeleton. Throws a DOM-missing error otherwise.
 */
export async function waitForSunoCreateFormReady(page: Page, timeoutMs: number): Promise<void> {
  try {
    await Promise.any(
      SUNO_CREATE_FORM_READY_SELECTORS.map((selector) =>
        page.locator(selector).first().waitFor({ state: "visible", timeout: timeoutMs })
      )
    );
  } catch {
    throw new Error(
      `${SUNO_CREATE_FORM_MISSING_REASON}: create form not found within ${timeoutMs}ms; none of [${SUNO_CREATE_FORM_READY_SELECTORS.join(", ")}] became visible after Clerk handshake`
    );
  }
}

/**
 * Ensure the lyrics editor is present before any lyrics fill and return it.
 *
 * The v5.5 lyrics editor lives in the "Advanced" create tab. If the editor is not
 * already visible, select the Advanced tab (older builds: click "Add your own
 * lyrics") to reveal it, then resolve the editor. The resolved locator is the
 * contenteditable lyrics body — never the "Cowriter prompt" co-writer chat box.
 */
export async function ensureSunoLyricsMode(page: Page, timeoutMs: number): Promise<Locator> {
  const editor = page.locator(SUNO_CREATE_SELECTORS.lyricsEditor).first();
  if (await editor.isVisible().catch(() => false)) {
    return editor;
  }
  const advancedTab = await resolveFirstVisibleLocator(
    page,
    SUNO_CREATE_FALLBACKS.advancedTab,
    timeoutMs,
    "Advanced create tab"
  ).catch(() => undefined);
  if (advancedTab) {
    const alreadySelected = (await advancedTab.getAttribute("aria-selected").catch(() => null)) === "true";
    if (!alreadySelected) {
      await advancedTab.click().catch(() => undefined);
    }
  }
  return resolveFirstVisibleLocator(page, SUNO_CREATE_FALLBACKS.lyricsEditor, timeoutMs, "lyrics editor");
}

/** Style textarea locator using the shared fallback list (one joined selector). */
export function sunoStyleLocator(page: Page): Locator {
  return page.locator(SUNO_STYLE_SELECTOR);
}
