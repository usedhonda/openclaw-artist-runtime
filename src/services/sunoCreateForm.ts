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
  lyricsTextarea: 'textarea[data-testid="lyrics-textarea"]',
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
  lyricsTextarea: [
    SUNO_CREATE_SELECTORS.lyricsTextarea,
    'textarea[placeholder*="lyrics"]',
    'textarea[placeholder*="歌詞"]'
  ],
  addLyricsButton: [
    SUNO_CREATE_SELECTORS.addLyricsButton,
    'button:has-text("Add your own lyrics")',
    'button[aria-label*="own lyrics"]',
    'button:has-text("Custom")'
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
 * Ensure the lyrics textarea is present before any lyrics fill. If it is not
 * visible, the page is in "Simple" mode: click "Add your own lyrics" (custom
 * mode) to mount the textarea. Returns the resolved, visible lyrics textarea.
 */
export async function ensureSunoLyricsMode(page: Page, timeoutMs: number): Promise<Locator> {
  const textarea = page.locator(SUNO_CREATE_SELECTORS.lyricsTextarea).first();
  if (await textarea.isVisible().catch(() => false)) {
    return textarea;
  }
  const toggle = await resolveFirstVisibleLocator(
    page,
    SUNO_CREATE_FALLBACKS.addLyricsButton,
    timeoutMs,
    "add-your-own-lyrics toggle"
  ).catch(() => undefined);
  if (toggle) {
    await toggle.click().catch(() => undefined);
  }
  return resolveFirstVisibleLocator(page, SUNO_CREATE_FALLBACKS.lyricsTextarea, timeoutMs, "lyrics textarea");
}

/** Style textarea locator using the shared fallback list (one joined selector). */
export function sunoStyleLocator(page: Page): Locator {
  return page.locator(SUNO_STYLE_SELECTOR);
}
