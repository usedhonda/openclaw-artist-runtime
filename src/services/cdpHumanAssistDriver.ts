import { readFile } from "node:fs/promises";
import type { BrowserContext, Locator, Page } from "playwright";
import type { SunoCreatePayload } from "../types.js";
import { SunoBrowserService, sunoBrowserService } from "./sunoBrowserService.js";
import type { SunoBrowserConfigView } from "./runtimeConfig.js";
import { SUNO_CREATE_URL } from "./sunoPlaywrightDriver.js";
import {
  SUNO_CREATE_FALLBACKS,
  SUNO_EXPECTED_TAKE_COUNT,
  ensureSunoLyricsMode,
  ensureSunoStyleMode,
  filterFreshTakeUrls,
  readSunoCreateCardSongUrls,
  resolveFirstVisibleLocator,
  waitForSunoCreateFormReady
} from "./sunoCreateForm.js";
import { fetchSunoFeedClips, selectFreshFeedTakeUrls } from "./sunoFeedHarvest.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";
import type {
  HumanAssistBrowserDriver,
  HumanAssistSubmitOutcome,
  HumanAssistWaitOutcome
} from "./sunoHumanAssist.js";

/**
 * Best-effort implementation of HumanAssistBrowserDriver for the captcha human-assist
 * fallback on the operator machine.
 *
 * It obtains the logged-in Suno browser from the plugin-owned SunoBrowserService (which
 * launches the persistent `suno` profile, or attaches to a legacy CDP Chrome), auto-fills
 * the create form, and tries a machine Create click. If a captcha challenge appears, it
 * closes the challenge overlay
 * (Escape only -- it never solves or bypasses it) and polls for the producer's manual
 * Create click. Suno is contacted only here; this module is deliberately NOT unit
 * tested against a live DOM (selectors are validated on the real machine at the next
 * live create). The tested contract lives in the state machine (sunoHumanAssist.ts)
 * and the connector decorator, which both drive this class through the injectable
 * HumanAssistBrowserDriver interface.
 */

// Distinct wait failure: the tab/browser the producer was to press Create on is gone.
export const HUMAN_ASSIST_BROWSER_GONE_REASON = "human_assist_browser_gone";

/**
 * Throw the browser-gone failure when the create page is missing or closed. A closed
 * Playwright page also reports isClosed()=true when its context/browser disconnects, so
 * this covers both a manually closed tab and a browser exit. Called each wait iteration
 * so a dead target ends the wait instead of polling forever.
 */
export function assertBrowserAlive(page: Pick<Page, "isClosed"> | undefined): void {
  if (!page || page.isClosed()) {
    throw new Error(HUMAN_ASSIST_BROWSER_GONE_REASON);
  }
}

const CAPTCHA_MARKERS = 'iframe[src*="hcaptcha"], iframe[title*="hCaptcha"], iframe[src*="turnstile"], [id*="hcaptcha"]';

const FORM_READY_TIMEOUT_MS = 25_000;
const CLICK_TIMEOUT_MS = 25_000;
const POST_CLICK_SETTLE_MS = 6_000;
const POLL_INTERVAL_MS = 3_000;
// The feed reflects a fresh generate a few seconds after submit (observed ~9s on-device),
// so give it a short bounded poll before falling back to the DOM harvest.
const FEED_RECONCILE_ATTEMPTS = 5;
const FEED_RECONCILE_INTERVAL_MS = 3_000;
const INFORMATIONAL_DIALOG_CLOSE_TIMEOUT_MS = 5_000;
const DIALOG_SELECTOR = '[role="dialog"]';
const DIALOG_CLOSE_SELECTOR = 'button[aria-label="Close"]';
const SENSITIVE_DIALOG_CONTROL_SELECTOR = "input, textarea, select, iframe";
const SENSITIVE_DIALOG_TEXT =
  /\b(?:captcha|turnstile|verify you are human|sign\s*in|log\s*in|password|payment|billing|checkout|credit card|debit card|card number|cvv|purchase|pay now|accept|agree|consent)\b/i;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function extractLyrics(payload: SunoCreatePayload): string | undefined {
  // `payloadYaml` includes non-lyric registration metadata and can exceed a text
  // field's practical limit. The explicit lyrics body is the only value for Suno's
  // Lyrics editor; retain the YAML only as a legacy fallback.
  return readText(payload.lyrics) ?? readText(payload.lyricsText) ?? readText(payload.payloadYaml);
}

/**
 * Close a non-transactional Suno notice or upsell through its explicit Close
 * control. Dialogs with form/challenge controls or sensitive login, payment,
 * consent, and captcha language remain visible and fail closed.
 */
export async function dismissSafeSunoBlockingDialog(page: Page): Promise<boolean> {
  const dialogs = page.locator(DIALOG_SELECTOR);
  const dialogCount = await dialogs.count();
  for (let index = 0; index < dialogCount; index += 1) {
    const dialog = dialogs.nth(index);
    if (!(await dialog.isVisible().catch(() => false))) continue;
    const text = await dialog.innerText().catch(() => "");
    if (SENSITIVE_DIALOG_TEXT.test(text)) continue;
    if ((await dialog.locator(SENSITIVE_DIALOG_CONTROL_SELECTOR).count()) > 0) continue;
    const closeButton = dialog.locator(DIALOG_CLOSE_SELECTOR).first();
    if (!(await closeButton.isVisible().catch(() => false))) continue;
    await closeButton.click({ timeout: INFORMATIONAL_DIALOG_CLOSE_TIMEOUT_MS });
    return true;
  }
  return false;
}

export interface CdpHumanAssistDriverInput {
  payload: SunoCreatePayload;
  service?: SunoBrowserService;
  config?: SunoBrowserConfigView;
  // Path to the suno-cli session.json used to mint the Clerk JWT for the network-primary
  // feed harvest. When omitted (tests, or no workspace root), harvest stays DOM-only.
  sessionFile?: string;
}

export interface SunoSessionCookie {
  name: string;
  value: string;
  url?: "https://suno.com" | "https://auth.suno.com";
  domain?: ".suno.com";
  path?: "/";
  secure?: true;
}

export function parseSunoSessionCookieHeader(cookieHeader: string): SunoSessionCookie[] {
  const cookies: SunoSessionCookie[] = [];
  let plainSessionCount = 0;
  for (const segment of cookieHeader.split(/;\s*/)) {
    const separator = segment.indexOf("=");
    if (separator <= 0) continue;
    const name = segment.slice(0, separator).trim();
    const value = segment.slice(separator + 1);
    if (!name || !value) continue;
    if (name === "__session") {
      cookies.push(plainSessionCount++ === 0
        ? { name, value, domain: ".suno.com", path: "/", secure: true }
        : { name, value, url: "https://suno.com" });
      continue;
    }
    if (name.startsWith("__session_") || name === "clerk_active_context") {
      cookies.push({ name, value, url: "https://suno.com" });
      continue;
    }
    if (name === "__client" || (name.startsWith("__client_") && !name.startsWith("__client_uat"))) {
      cookies.push({ name, value, url: "https://auth.suno.com" });
      continue;
    }
    if (name.startsWith("__client_uat")) {
      cookies.push({ name, value, domain: ".suno.com", path: "/", secure: true });
    }
  }
  return cookies;
}

export async function hydrateSunoBrowserSession(
  context: Pick<BrowserContext, "addCookies">,
  sessionFile: string | undefined
): Promise<boolean> {
  if (!sessionFile) return false;
  const contents = await readFile(sessionFile, "utf8").catch(() => "");
  if (!contents) return false;
  const parsed = (() => {
    try {
      return JSON.parse(contents) as { cookie?: unknown };
    } catch {
      return {};
    }
  })();
  if (typeof parsed.cookie !== "string") return false;
  const cookies = parseSunoSessionCookieHeader(parsed.cookie);
  if (!cookies.some((cookie) => cookie.name === "__session")) return false;
  await context.addCookies(cookies);
  return true;
}

export class CdpHumanAssistDriver implements HumanAssistBrowserDriver {
  private page: Page | undefined;
  private ownsPage = false;
  private baselineSongUrls = new Set<string>();
  // Feed clip ids present before submit, so only genuinely new clips count as this
  // create's takes during network-primary reconciliation.
  private baselineFeedIds = new Set<string>();
  private submitAtMs = 0;
  private readonly service: SunoBrowserService;

  constructor(private readonly input: CdpHumanAssistDriverInput) {
    this.service = input.service ?? sunoBrowserService;
  }

  async openAndFill(): Promise<void> {
    const { context } = await this.service.ensureRunning(this.input.config);
    const existing = context.pages().find((page) => {
      try {
        return page.url().includes("suno.com");
      } catch {
        return false;
      }
    });
    // The persistent browser profile is the operator's authentication authority.
    // Never overwrite it with the CLI session file: that file can lag a fresh manual
    // login and cause a newly opened tab to render a different, partial Create surface.
    const page = existing ?? (await context.newPage());
    this.ownsPage = !existing;
    await page.goto(SUNO_CREATE_URL, { waitUntil: "domcontentloaded", timeout: FORM_READY_TIMEOUT_MS });
    // Wait for the form to render past the Clerk handshake using any-of form-ready
    // selectors (not just the Create button) so a single relabel does not defeat the gate.
    await waitForSunoCreateFormReady(page, FORM_READY_TIMEOUT_MS);
    this.page = page;
    // Baseline is title-scoped so pre-existing takes of the SAME title (earlier
    // attempts today) are excluded and only genuinely new takes count as fresh.
    this.baselineSongUrls = new Set(await this.readTakeUrls());
    // Feed baseline (best-effort): every clip id that already exists in the account, so
    // the network-primary reconciliation never adopts a pre-existing clip as this take.
    this.baselineFeedIds = await this.readFeedClipIds();

    const payload = this.input.payload;
    const lyrics = extractLyrics(payload);
    if (lyrics && !payload.instrumental) {
      // The create page opens in "Simple" mode with no lyrics textarea. Switch to
      // custom mode first, otherwise the fill waits forever on an unmounted element.
      const lyricsField = await ensureSunoLyricsMode(page, FORM_READY_TIMEOUT_MS);
      await lyricsField.fill(lyrics, { timeout: FORM_READY_TIMEOUT_MS });
    }
    const style = readText(payload.styleAndFeel);
    if (style) {
      const styleField = await ensureSunoStyleMode(page, FORM_READY_TIMEOUT_MS);
      await styleField.fill(style, { timeout: FORM_READY_TIMEOUT_MS });
    }
    const title = readText(payload.songName);
    if (title) {
      // The current homepage composer does not expose a title field. Song title is
      // optional metadata, so its absence must not prevent the producer from seeing
      // the fully prepared lyrics and style form before the manual Create boundary.
      const titleField = await resolveFirstVisibleLocator(
        page,
        SUNO_CREATE_FALLBACKS.titleInput,
        FORM_READY_TIMEOUT_MS,
        "title"
      ).catch(() => undefined);
      if (titleField) {
        await titleField.fill(title, { timeout: FORM_READY_TIMEOUT_MS });
      }
    }
    const exclude = readText(payload.excludeStyles);
    if (exclude) {
      // Exclude styles is optional and absent from the current homepage composer.
      // Keep the producer's prepared form usable when Suno omits this legacy field.
      const excludeField = await resolveFirstVisibleLocator(
        page,
        SUNO_CREATE_FALLBACKS.excludeInput,
        FORM_READY_TIMEOUT_MS,
        "exclude styles"
      ).catch(() => undefined);
      if (excludeField) {
        await excludeField.fill(exclude, { timeout: FORM_READY_TIMEOUT_MS });
      }
    }
    // Leave the producer a usable form in manual-submit mode. Only safe
    // informational/upsell overlays are closed; sensitive surfaces stay visible.
    await dismissSafeSunoBlockingDialog(page);
  }

  async attemptMachineSubmit(): Promise<HumanAssistSubmitOutcome> {
    const page = this.requirePage();
    // Suno can place site-news or upsell dialogs over an otherwise complete
    // create form. Dismiss only a safe explicit-Close surface before resolving
    // Create so Playwright does not burn repeated 25-second pointer retries.
    await dismissSafeSunoBlockingDialog(page);
    const createButton = await resolveFirstVisibleLocator(
      page,
      SUNO_CREATE_FALLBACKS.createButton,
      CLICK_TIMEOUT_MS,
      "Create song button"
    );
    // Record the submit instant BEFORE the click so feed reconciliation can filter clips
    // to those created at/after this create fired.
    this.submitAtMs = Date.now();
    await createButton.click({ timeout: CLICK_TIMEOUT_MS });
    await sleep(POST_CLICK_SETTLE_MS);
    // Captcha is checked FIRST and, when present, the flow hands off to the human
    // WITHOUT harvesting URLs — a captcha means the submit did not go through, so any
    // song links on the page belong to the existing workspace, not to a new take.
    if (await this.hasCaptchaChallenge()) {
      return { kind: "captcha_challenge" };
    }
    const fresh = await this.freshTakeUrls();
    if (fresh.length > 0) {
      return { kind: "accepted", urls: await this.reconcileTakesFromFeed(fresh) };
    }
    // No captcha visible and no new take yet: give Suno a brief settle window before
    // deciding, then treat a lingering captcha as a challenge, otherwise fall back to
    // the human path (safer than declaring an error and hard-stopping).
    await sleep(POST_CLICK_SETTLE_MS);
    if (await this.hasCaptchaChallenge()) {
      return { kind: "captcha_challenge" };
    }
    const settled = await this.freshTakeUrls();
    if (settled.length > 0) {
      return { kind: "accepted", urls: await this.reconcileTakesFromFeed(settled) };
    }
    return { kind: "captcha_challenge" };
  }

  async closeChallengeOverlay(): Promise<void> {
    const page = this.requirePage();
    // Close only -- never interact with the captcha to solve it. Escape dismisses the
    // Suno challenge modal while leaving the filled form intact for the manual click.
    await page.keyboard.press("Escape").catch(() => undefined);
  }

  async bringToFront(): Promise<void> {
    await this.page?.bringToFront?.().catch(() => undefined);
  }

  async waitForHumanSubmit(timeoutMs: number): Promise<HumanAssistWaitOutcome> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // If the producer closed the tab (or the browser disconnected) there is no live
      // target left to submit on. Reject with a distinct reason instead of polling a
      // dead page forever: freshTakeUrls swallows the closed-target error to [], so
      // without this the wait would never resolve and the single-flight marker would
      // block every future attempt. Rejecting lets the flow's finally clear the marker
      // and the autopilot start a fresh attempt.
      assertBrowserAlive(this.page);
      // Only a NEW title-scoped take (the producer's manual Create actually starting a
      // generation) counts as success. Workspace bleed / over-count is rejected inside
      // freshTakeUrls, so this never accepts unrelated existing songs.
      const fresh = await this.freshTakeUrls().catch(() => [] as string[]);
      if (fresh.length > 0) {
        return { kind: "accepted", urls: await this.reconcileTakesFromFeed(fresh) };
      }
      await sleep(POLL_INTERVAL_MS);
    }
    return { kind: "timeout" };
  }

  async retireCreateSurface(): Promise<void> {
    // Success-only cosmetic step. An owned page is closed outright by close(); a
    // reused attach-mode tab is externally owned, so instead of leaving the filled
    // Create form on screen we return it to the Suno home surface. Best-effort: any
    // navigation failure is ignored because the create was already accepted.
    const page = this.page;
    if (!page || this.ownsPage) {
      return;
    }
    await page
      .goto("https://suno.com/", { waitUntil: "domcontentloaded", timeout: FORM_READY_TIMEOUT_MS })
      .catch(() => undefined);
  }

  async close(): Promise<void> {
    // Drop our page reference and release the SunoBrowserService hold. The service
    // idle-closes the plugin-launched browser once the last holder releases (a legacy
    // CDP attach is left running); a later attempt re-acquires cleanly.
    const page = this.page;
    this.page = undefined;
    if (this.ownsPage) {
      await page?.close().catch(() => undefined);
    }
    this.ownsPage = false;
    await this.service.release();
  }

  private requirePage(): Page {
    if (!this.page) {
      throw new Error("human_assist_page_not_open: call openAndFill first");
    }
    return this.page;
  }

  private async fillCandidates(
    candidates: readonly string[],
    fieldName: string,
    value: string
  ): Promise<void> {
    const field: Locator = await resolveFirstVisibleLocator(
      this.requirePage(),
      candidates,
      FORM_READY_TIMEOUT_MS,
      fieldName
    );
    await field.fill(value, { timeout: FORM_READY_TIMEOUT_MS });
  }

  private async hasCaptchaChallenge(): Promise<boolean> {
    const page = this.page;
    if (!page) return false;
    const count = await page.locator(CAPTCHA_MARKERS).count().catch(() => 0);
    return count > 0;
  }

  private expectedTitle(): string {
    return readText(this.input.payload.songName) ?? "";
  }

  private async readTakeUrls(): Promise<string[]> {
    const page = this.page;
    if (!page) return [];
    // Title-scoped create-card detection (shared with the Playwright lane). An empty
    // title yields [] so an untitled create never mis-attributes workspace songs.
    return readSunoCreateCardSongUrls(page, this.expectedTitle());
  }

  /**
   * New title-scoped takes since baseline, capped at the expected take count. When more
   * than the expected number appear (scope leak / workspace bleed), the batch is
   * rejected and a warning event is emitted — never returned as a fake success.
   */
  private async freshTakeUrls(): Promise<string[]> {
    const current = await this.readTakeUrls();
    const { urls, overCount } = filterFreshTakeUrls(current, this.baselineSongUrls, SUNO_EXPECTED_TAKE_COUNT);
    if (overCount) {
      emitRuntimeEvent({
        type: "error",
        source: "suno_human_assist",
        reason: `take_urls_over_expected: ${current.length} title-scoped urls for "${this.expectedTitle()}" exceed expected ${SUNO_EXPECTED_TAKE_COUNT}; rejecting as scope leak`,
        timestamp: Date.now()
      });
    }
    return urls;
  }

  /**
   * Every clip id already in the account feed, captured before submit. Best-effort: an
   * empty set (no sessionFile, or the feed is unavailable) simply means the network
   * reconciliation relies on the created-at floor and title scope alone, then the DOM
   * fallback.
   */
  private async readFeedClipIds(): Promise<Set<string>> {
    const sessionFile = this.input.sessionFile;
    if (!sessionFile) {
      return new Set();
    }
    const clips = await fetchSunoFeedClips({ sessionFile }).catch(() => []);
    const ids = new Set<string>();
    for (const clip of clips) {
      const id = typeof clip.id === "string" && clip.id.trim() ? clip.id.trim() : undefined;
      if (id) {
        ids.add(id);
      }
    }
    return ids;
  }

  /**
   * Network-primary take reconciliation. Once the DOM signals a fresh take appeared (fast
   * "generation started" signal), poll the authenticated feed for the clips this create
   * actually produced — exact title, created at/after submit, not in the pre-submit
   * baseline. Feed URLs are authoritative and immune to the create-page cross-card bleed;
   * the DOM-harvested URLs are used only when the feed yields nothing (unavailable, or an
   * over-count anomaly).
   */
  private async reconcileTakesFromFeed(domUrls: string[]): Promise<string[]> {
    const sessionFile = this.input.sessionFile;
    if (!sessionFile) {
      return domUrls;
    }
    for (let attempt = 0; attempt < FEED_RECONCILE_ATTEMPTS; attempt += 1) {
      const clips = await fetchSunoFeedClips({ sessionFile }).catch(() => []);
      const { urls, overCount } = selectFreshFeedTakeUrls({
        clips,
        title: this.expectedTitle(),
        sinceMs: this.submitAtMs,
        baselineIds: this.baselineFeedIds,
        expectedCount: SUNO_EXPECTED_TAKE_COUNT
      });
      if (urls.length > 0) {
        console.log(`[suno-feed] harvest_used song="${this.expectedTitle()}" takes=${urls.length}`);
        return urls;
      }
      if (overCount) {
        emitRuntimeEvent({
          type: "error",
          source: "suno_human_assist",
          reason: `feed_take_over_expected: fresh feed clips for "${this.expectedTitle()}" exceed expected ${SUNO_EXPECTED_TAKE_COUNT}; falling back to DOM harvest`,
          timestamp: Date.now()
        });
        break;
      }
      await sleep(FEED_RECONCILE_INTERVAL_MS);
    }
    console.log(`[suno-feed] harvest_fallback_dom song="${this.expectedTitle()}" domTakes=${domUrls.length}`);
    return domUrls;
  }
}
