import type { Locator, Page } from "playwright";
import { PLAYWRIGHT_EXPECTED_CREATE_CARD_COUNT } from "./sunoTakeConstants.js";

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
  writeLyricsTab: 'button:has-text("Write Lyrics")',
  stylesButton: 'button:has-text("Styles")',
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
    'textarea[aria-label*="lyric" i]',
    'textarea[placeholder*="lyric" i]',
    'textarea[name*="lyric" i]',
    SUNO_CREATE_SELECTORS.lyricsTextarea
  ],
  // The current Create workspace starts in "Describe your lyrics" mode.
  // Select "Write Lyrics" first; older Advanced/custom entry points remain fallbacks.
  advancedTab: [
    SUNO_CREATE_SELECTORS.writeLyricsTab,
    SUNO_CREATE_SELECTORS.advancedTab,
    '[role="tab"][aria-label="Advanced"]',
    'button:has-text("Advanced")',
    SUNO_CREATE_SELECTORS.addLyricsButton,
    'button:has-text("Add your own lyrics")'
  ],
  customMode: [
    'button:has-text("Custom")',
    'button[aria-label*="Custom" i]'
  ],
  style: [
    '[data-testid="create-form-styles-wrapper"] textarea',
    'textarea[aria-label*="style" i]',
    'textarea[placeholder*="style" i]',
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
  SUNO_CREATE_SELECTORS.lyricsTextarea,
  SUNO_CREATE_SELECTORS.stylesWrapper,
  ...SUNO_CREATE_FALLBACKS.advancedTab,
  ...SUNO_CREATE_FALLBACKS.createButton
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

async function clickVisibleLocatorWithRetry(
  page: Page,
  candidates: readonly string[],
  timeoutMs: number,
  fieldName: string
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const remainingMs = Math.max(1, deadline - Date.now());
    const locator = await resolveFirstVisibleLocator(page, candidates, remainingMs, fieldName);
    try {
      await locator.click({ timeout: remainingMs });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`${SUNO_CREATE_FORM_MISSING_REASON}: ${fieldName} click failed after 3 attempts: ${detail}`);
}

/**
 * Ensure the lyrics editor is present before any lyrics fill and return it.
 *
 * The current Create workspace exposes the lyrics editor through "Write Lyrics";
 * older builds use Advanced or "Add your own lyrics". If the editor is not already
 * visible, select that entry point, then resolve the editor. The resolved locator is the
 * contenteditable lyrics body — never the "Cowriter prompt" co-writer chat box.
 */
export async function ensureSunoLyricsMode(page: Page, timeoutMs: number): Promise<Locator> {
  const visibleEditor = async (): Promise<Locator | undefined> => {
    for (const selector of SUNO_CREATE_FALLBACKS.lyricsEditor) {
      const candidate = page.locator(selector).first();
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
    return undefined;
  };
  const existingEditor = await visibleEditor();
  if (existingEditor) {
    return existingEditor;
  }
  const advancedTab = await resolveFirstVisibleLocator(
    page,
    SUNO_CREATE_FALLBACKS.advancedTab,
    timeoutMs,
    "Write Lyrics or Advanced create tab"
  ).catch(() => undefined);
  if (advancedTab) {
    const alreadySelected = (await advancedTab.getAttribute("aria-selected").catch(() => null)) === "true";
    if (!alreadySelected) {
      await clickVisibleLocatorWithRetry(
        page,
        SUNO_CREATE_FALLBACKS.advancedTab,
        timeoutMs,
        "Write Lyrics or Advanced create tab"
      );
    }
  }
  const editorAfterAdvanced = await visibleEditor();
  if (editorAfterAdvanced) {
    return editorAfterAdvanced;
  }
  const customMode = await resolveFirstVisibleLocator(
    page,
    SUNO_CREATE_FALLBACKS.customMode,
    timeoutMs,
    "Custom lyrics mode"
  ).catch(() => undefined);
  if (customMode) {
    await clickVisibleLocatorWithRetry(
      page,
      SUNO_CREATE_FALLBACKS.customMode,
      timeoutMs,
      "Custom lyrics mode"
    );
  }
  return resolveFirstVisibleLocator(page, SUNO_CREATE_FALLBACKS.lyricsEditor, timeoutMs, "lyrics editor");
}

/**
 * The current homepage keeps Styles in a collapsed section. Return a visible style
 * textarea, opening that section when required, without touching the Create action.
 */
export async function ensureSunoStyleMode(page: Page, timeoutMs: number): Promise<Locator> {
  for (const selector of SUNO_CREATE_FALLBACKS.style) {
    const candidate = page.locator(selector).first();
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  await clickVisibleLocatorWithRetry(page, [SUNO_CREATE_SELECTORS.stylesButton], timeoutMs, "Styles section");
  return resolveFirstVisibleLocator(page, SUNO_CREATE_FALLBACKS.style, timeoutMs, "style textarea");
}

/** Legacy synchronous locator used by the background-browser lane. */
export function sunoStyleLocator(page: Page): Locator {
  return page.locator(SUNO_STYLE_SELECTOR);
}

/** Suno always renders exactly this many take cards per generation. */
export { PLAYWRIGHT_EXPECTED_CREATE_CARD_COUNT as SUNO_EXPECTED_TAKE_COUNT };

export function escapeSunoAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Read the create-page song URLs for a finished take, SCOPED to the created song's
 * title. Suno's create workspace surfaces a finished take as a title-scoped play
 * control (`aria-label="Play <title>"` / `"Play <title> from start"`) whose nearby
 * thumbnail image URL (`cdn2.suno.ai/image[_large]_<uuid>.jpeg`) carries the song id.
 *
 * Title scoping is a fail-closed guardrail: an unscoped `a[href*="/song/"]` scrape
 * harvests the whole workspace sidebar and mis-attributes unrelated existing songs as
 * this create's takes (the false-accepted bug on the human-assist lane). An empty
 * title returns [] rather than every song on the page.
 */
export function readSunoPlayControlSongUrls(page: Page, selector: string): Promise<string[]> {
  return page
    .locator(selector)
    .evaluateAll((controls) => {
      const urls = new Set<string>();
      for (const control of controls) {
        let current: Element | null = control;
        let img: Element | null = null;
        for (let depth = 0; current && depth < 10; depth += 1) {
          img = current.querySelector("img[src*='suno.ai/image'], img[data-src*='suno.ai/image']");
          if (img) {
            break;
          }
          current = current.parentElement;
        }
        const source = img?.getAttribute("data-src") ?? img?.getAttribute("src") ?? "";
        const match = source.match(
          /image(?:_large)?_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
        );
        if (match) {
          urls.add(`https://suno.com/song/${match[1]}`);
        }
      }
      return Array.from(urls);
    })
    .catch(() => [] as string[]);
}

export async function readSunoCreateCardSongUrls(page: Page, expectedTitle: string): Promise<string[]> {
  const title = expectedTitle.trim();
  if (!title) {
    return [];
  }
  const escapedTitle = escapeSunoAttributeValue(title);
  const titleScopedSelectors = [
    `[aria-label="Play ${escapedTitle}"], [aria-label^="Play ${escapedTitle} "]`,
    `button[aria-label="Play ${escapedTitle}"]`,
    `button[aria-label^="Play ${escapedTitle} "]`,
    `[aria-label="Play ${escapedTitle}"]`,
    `[aria-label^="Play ${escapedTitle} "]`
  ];
  const urls = new Set<string>();
  for (const selector of titleScopedSelectors) {
    for (const url of await readSunoPlayControlSongUrls(page, selector)) {
      urls.add(url);
    }
  }
  return Array.from(urls);
}

export interface FreshTakeUrlResult {
  /** Newly-appeared take URLs for this create, capped at the expected take count. */
  urls: string[];
  /**
   * True when the number of new title-scoped URLs exceeds the expected take count —
   * a signal the scope leaked (workspace bleed). The caller must NOT treat this as a
   * successful create; it should reject the batch and surface a warning.
   */
  overCount: boolean;
}

/**
 * Pure guard for take-URL acceptance. Removes the pre-create baseline, then fails
 * closed when more than the expected number of takes appear (scope leak / bleed).
 * A create is only "accepted" when 1..expected fresh title-scoped URLs are present.
 */
export function filterFreshTakeUrls(
  currentUrls: readonly string[],
  baselineUrls: ReadonlySet<string>,
  expectedCount: number = PLAYWRIGHT_EXPECTED_CREATE_CARD_COUNT
): FreshTakeUrlResult {
  const fresh = Array.from(new Set(currentUrls.filter((url) => !baselineUrls.has(url))));
  if (fresh.length > expectedCount) {
    return { urls: [], overCount: true };
  }
  return { urls: fresh, overCount: false };
}
